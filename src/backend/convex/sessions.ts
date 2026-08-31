// Session lifecycle: lobby → active → ended. The session's unguessable id is
// its URL and its only auth (v0). Whoever creates the session is the
// therapist; children join by name while the session is still in the lobby.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { cancelAllPending } from "./intents";
import { deriveChildStats } from "./lib/participation";
import { DOMINANCE_WINDOW_MS, ENGINE_TICK_MS } from "./lib/constants";

export const create = mutation({
  args: { exerciseDescription: v.string(), therapistName: v.string() },
  returns: v.object({ sessionId: v.id("sessions"), participantId: v.id("participants") }),
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("sessions", {
      status: "lobby",
      exerciseDescription: args.exerciseDescription,
      agentAutonomyDial: "autonomous",
      agentMuted: false,
    });
    const participantId = await ctx.db.insert("participants", {
      sessionId,
      name: args.therapistName,
      role: "therapist",
      expectedParticipationWeight: 0, // therapists are never draw-out targets
      muted: false,
      airtimeMs: 0,
      actionCount: 0,
    });
    return { sessionId, participantId };
  },
});

export const join = mutation({
  args: { sessionId: v.id("sessions"), name: v.string() },
  returns: v.object({ participantId: v.id("participants") }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "lobby") {
      throw new Error(
        session.status === "active"
          ? "This session has already started — joins are locked."
          : "This session has ended.",
      );
    }
    const name = args.name.trim();
    if (name.length === 0 || name.length > 40) throw new Error("Please enter a name.");
    const participantId = await ctx.db.insert("participants", {
      sessionId: args.sessionId,
      name,
      role: "child",
      expectedParticipationWeight: 1,
      muted: false,
      airtimeMs: 0,
      actionCount: 0,
    });
    return { participantId };
  },
});

/** Entry point for any pasted URL: tolerant of malformed ids. */
export const resolve = query({
  args: { sessionId: v.string() },
  returns: v.union(schema.doc("sessions"), v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("sessions", args.sessionId);
    if (!id) return null;
    return await ctx.db.get("sessions", id);
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(schema.doc("sessions"), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("sessions", args.sessionId);
  },
});

export const roster = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(schema.doc("participants")),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
  },
});

/** Locks joins, starts the engine tick loop, dispatches the media worker. */
export const start = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "lobby") return null;
    await ctx.db.patch("sessions", args.sessionId, { status: "active", startedAt: Date.now() });
    await ctx.scheduler.runAfter(ENGINE_TICK_MS, internal.engine.tick, {
      sessionId: args.sessionId,
      n: 1,
    });
    await ctx.scheduler.runAfter(0, internal.livekit.dispatchAgent, { sessionId: args.sessionId });
    return null;
  },
});

/** Ends the session: cancels pending cards, freezes the transcript, kicks the
 * one end-of-session notes call. The same URL becomes the review page. */
export const end = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") return null;
    await cancelAllPending(ctx, args.sessionId, "stale");

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    const names = new Map(participants.map((p) => [p._id, p.name]));
    const utterances = await ctx.db
      .query("utterances")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(2000);
    const startedAt = session.startedAt ?? session._creationTime;
    const transcript = utterances
      .filter((u) => u.sttOk && u.text.trim().length > 0)
      .sort((a, b) => a.startAt - b.startAt)
      .map((u) => {
        const s = Math.max(0, Math.round((u.startAt - startedAt) / 1000));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return `[${mm}:${ss}] ${names.get(u.participantId) ?? "?"}: ${u.text}`;
      })
      .join("\n");

    await ctx.db.patch("sessions", args.sessionId, {
      status: "ended",
      endedAt: Date.now(),
      transcript,
    });
    await ctx.scheduler.runAfter(0, internal.notes.generate, { sessionId: args.sessionId });
    return null;
  },
});

const childStatsValidator = v.object({
  participantId: v.id("participants"),
  name: v.string(),
  weight: v.number(),
  airtimeMs: v.number(),
  windowAirtimeMs: v.number(),
  share: v.number(),
  windowShare: v.number(),
  expectedShare: v.number(),
  deficit: v.number(),
  lastActiveAt: v.union(v.number(), v.null()),
  silentForMs: v.number(),
  totalUtteranceCount: v.number(),
  lastUtteranceAt: v.union(v.number(), v.null()),
  promptsUsed: v.number(),
  ladderLevel: v.number(),
});

/** Live equity numbers for the therapist panel. `now` comes from the client
 * (queries must not read the wall clock) and is refreshed on an interval. */
export const stats = query({
  args: { sessionId: v.id("sessions"), now: v.number() },
  returns: v.array(childStatsValidator),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) return [];
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    const recentRows = await ctx.db
      .query("utterances")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(400);
    const recentUtterances = recentRows.filter((u) => u.endAt > args.now - DOMINANCE_WINDOW_MS);
    const intents = await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(200);
    const utteranceCounts: Record<string, number> = {};
    for (const p of participants) {
      if (p.role !== "child") continue;
      const two = await ctx.db
        .query("utterances")
        .withIndex("by_sessionId_and_participantId", (q) =>
          q.eq("sessionId", args.sessionId).eq("participantId", p._id),
        )
        .take(2);
      utteranceCounts[p._id] = two.length;
    }
    return deriveChildStats({
      session,
      participants,
      recentUtterances,
      intents,
      utteranceCounts,
      now: args.now,
    });
  },
});

/** Recent transcribed lines — feeds both the per-tile captions and the
 * supervise-mode transcript log. */
export const captions = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(schema.doc("utterances")),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("utterances")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(60);
    return rows.reverse();
  },
});

/** Everything the review page needs, bounded. Sessions are short-lived, so
 * these caps comfortably cover a full hour. */
export const review = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.object({
      session: schema.doc("sessions"),
      participants: v.array(schema.doc("participants")),
      utterances: v.array(schema.doc("utterances")),
      actions: v.array(schema.doc("actions")),
      intents: v.array(schema.doc("agentIntents")),
      flags: v.array(schema.doc("flags")),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) return null;
    const eq = (q: { eq: (f: "sessionId", v: typeof args.sessionId) => any }) =>
      q.eq("sessionId", args.sessionId);
    return {
      session,
      participants: await ctx.db.query("participants").withIndex("by_sessionId", eq).take(50),
      utterances: await ctx.db.query("utterances").withIndex("by_sessionId", eq).take(2000),
      actions: await ctx.db.query("actions").withIndex("by_sessionId", eq).take(500),
      intents: await ctx.db.query("agentIntents").withIndex("by_sessionId", eq).take(300),
      flags: await ctx.db.query("flags").withIndex("by_sessionId", eq).take(100),
    };
  },
});
