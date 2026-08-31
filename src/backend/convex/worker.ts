// The media worker's window into the brain. The worker is a dumb pipe: it
// pushes what it hears (utterances, airtime) and plays what the intent table
// tells it to. All decisions happen elsewhere.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, mutation, query } from "./_generated/server";
import { THOUGHT_GAP_MS, watchlistHit } from "./lib/constants";

/** One subscription drives the worker: session state + the intents it may
 * need to pre-synthesize (pending) or play (executed). The worker remembers
 * which ids it already played; rows executed before it connected are skipped. */
export const view = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.object({
      status: v.union(v.literal("lobby"), v.literal("active"), v.literal("ended")),
      agentMuted: v.boolean(),
      participants: v.array(
        v.object({
          _id: v.id("participants"),
          name: v.string(),
          role: v.union(v.literal("therapist"), v.literal("child")),
        }),
      ),
      pending: v.array(
        v.object({
          _id: v.id("agentIntents"),
          type: v.string(),
          utterance: v.union(v.string(), v.null()),
          ladderLevel: v.union(v.number(), v.null()),
        }),
      ),
      executed: v.array(
        v.object({
          _id: v.id("agentIntents"),
          type: v.string(),
          utterance: v.union(v.string(), v.null()),
          ladderLevel: v.union(v.number(), v.null()),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) return null;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    const pending = await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId_and_state", (q) =>
        q.eq("sessionId", args.sessionId).eq("state", "pending"),
      )
      .take(20);
    const executed = await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId_and_state", (q) =>
        q.eq("sessionId", args.sessionId).eq("state", "executed"),
      )
      .order("desc")
      .take(20);
    const slim = (r: (typeof pending)[number]) => ({
      _id: r._id,
      type: r.type as string,
      utterance: r.utterance ?? null,
      ladderLevel: r.ladderLevel ?? null,
    });
    return {
      status: session.status,
      agentMuted: session.agentMuted,
      participants: participants.map((p) => ({ _id: p._id, name: p.name, role: p.role })),
      pending: pending.map(slim),
      executed: executed.map(slim),
    };
  },
});

/** One STT final. STT endpoints aggressively, so a slow-speaking kid produces
 * many fragments per thought — MERGE-AT-WRITE: a final from the same speaker
 * starting within THOUGHT_GAP_MS of their previous row extends that row
 * instead of inserting. The DB keeps one row per THOUGHT, which is what every
 * consumer (actor context, transcript, first-share detection, review) wants.
 * A burst whose STT failed still lands (sttOk false) so airtime never lies.
 * Also the zero-latency distress tripwire — re-run on the merged text, so it
 * catches phrases split across fragments. Finally, schedules the debounced
 * wake check: the "someone may have finished a thought" signal. */
export const recordUtterance = mutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    startAt: v.number(),
    endAt: v.number(),
    text: v.string(),
    sttOk: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") return null; // late flushes are fine, just dropped
    const participant = await ctx.db.get("participants", args.participantId);
    if (!participant || participant.sessionId !== args.sessionId) return null;

    const last = (
      await ctx.db
        .query("utterances")
        .withIndex("by_sessionId_and_participantId", (q) =>
          q.eq("sessionId", args.sessionId).eq("participantId", args.participantId),
        )
        .order("desc")
        .take(1)
    )[0];

    let utteranceId;
    let fullText = args.text;
    const mergeable =
      args.sttOk &&
      last !== undefined &&
      last.sttOk &&
      last.text.trim().length > 0 &&
      args.text.trim().length > 0 &&
      args.startAt - last.endAt <= THOUGHT_GAP_MS;
    if (mergeable) {
      fullText = `${last.text} ${args.text.trim()}`;
      utteranceId = last._id;
      await ctx.db.patch("utterances", last._id, {
        endAt: Math.max(last.endAt, args.endAt),
        text: fullText,
      });
    } else {
      utteranceId = await ctx.db.insert("utterances", {
        sessionId: args.sessionId,
        participantId: args.participantId,
        startAt: args.startAt,
        endAt: args.endAt,
        text: args.text,
        sttOk: args.sttOk,
      });
    }
    if ((participant.lastActiveAt ?? 0) < args.endAt) {
      await ctx.db.patch("participants", args.participantId, { lastActiveAt: args.endAt });
    }

    // Watchlist tripwire: no LLM, no latency. The 10s evaluator sweep covers
    // phrasing this substring list misses; everything dedupes on utteranceId.
    const hit = args.sttOk ? watchlistHit(fullText) : null;
    if (hit && participant.role === "child") {
      const flags = await ctx.db
        .query("flags")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .take(100);
      if (!flags.some((f) => f.utteranceId === utteranceId)) {
        await ctx.db.insert("flags", {
          sessionId: args.sessionId,
          kind: "distress",
          participantId: args.participantId,
          text: fullText,
          utteranceId,
          status: "open",
        });
      }
    }

    // Thought-end debounce: only the check scheduled by the LAST fragment of
    // a thought survives its freshness guard and reaches the triggers.
    await ctx.scheduler.runAfter(THOUGHT_GAP_MS, internal.engine.wakeCheck, {
      sessionId: args.sessionId,
    });
    return null;
  },
});

/** Airtime heartbeat while someone is speaking (~3s cadence + a final flush).
 * This is the ONLY writer of airtimeMs — recordUtterance never adds airtime,
 * so the two paths can't double-count. */
export const bumpAirtime = mutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    deltaMs: v.number(),
    at: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") return null;
    const participant = await ctx.db.get("participants", args.participantId);
    if (!participant || participant.sessionId !== args.sessionId) return null;
    const delta = Math.max(0, Math.min(15_000, args.deltaMs));
    await ctx.db.patch("participants", args.participantId, {
      airtimeMs: participant.airtimeMs + delta,
      lastActiveAt: Math.max(participant.lastActiveAt ?? 0, args.at),
    });
    return null;
  },
});

/** Used by the token mint: does this participant belong to this session? */
export const participantForToken = internalQuery({
  args: { sessionId: v.string(), participantId: v.string() },
  returns: v.union(
    v.object({ name: v.string(), role: v.string(), sessionId: v.id("sessions") }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const sessionId = ctx.db.normalizeId("sessions", args.sessionId);
    const participantId = ctx.db.normalizeId("participants", args.participantId);
    if (!sessionId || !participantId) return null;
    const session = await ctx.db.get("sessions", sessionId);
    const participant = await ctx.db.get("participants", participantId);
    if (!session || session.status === "ended") return null;
    if (!participant || participant.sessionId !== sessionId) return null;
    return { name: participant.name, role: participant.role, sessionId };
  },
});
