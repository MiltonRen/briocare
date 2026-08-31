// The therapist's control surface. All plain guarded mutations; the named
// moves and the cue wake the same actor as the engine does, with a one-item
// menu (do_nothing is OFF it) — the therapist's tap IS the approval, so those
// intents execute the moment the utterance exists.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { cancelAllPending } from "./intents";
import type { Wake } from "./lib/triggers";

export const setDial = mutation({
  args: {
    sessionId: v.id("sessions"),
    dial: v.union(
      v.literal("suggest-only"),
      v.literal("auto-with-delay"),
      v.literal("autonomous"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("sessions", args.sessionId, { agentAutonomyDial: args.dial });
    return null;
  },
});

/** Mute drops every pending card — nothing queues behind a mute. */
export const setAgentMuted = mutation({
  args: { sessionId: v.id("sessions"), muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("sessions", args.sessionId, { agentMuted: args.muted });
    if (args.muted) await cancelAllPending(ctx, args.sessionId, "muted");
    return null;
  },
});

/** Live-adjustable. 0 = never targeted by any trigger. */
export const setWeight = mutation({
  args: { participantId: v.id("participants"), weight: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const weight = Math.max(0, Math.min(2, args.weight));
    await ctx.db.patch("participants", args.participantId, {
      expectedParticipationWeight: weight,
    });
    return null;
  },
});

/** `muted` mirrors the kid's ACTUAL mic. Two writers: the therapist's
 * mute/unmute buttons (a command the kid's client applies to the real mic),
 * and the kid's own client reporting its real mic transitions back — so the
 * dashboard and the microphone never drift apart. */
export const setParticipantMuted = mutation({
  args: { participantId: v.id("participants"), muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("participants", args.participantId, { muted: args.muted });
    return null;
  },
});

export const setPreSessionNote = mutation({
  args: { participantId: v.id("participants"), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("participants", args.participantId, { preSessionNote: args.note });
    return null;
  },
});

export const setPostSessionNote = mutation({
  args: { participantId: v.id("participants"), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("participants", args.participantId, { postSessionNote: args.note });
    return null;
  },
});

export const ackFlag = mutation({
  args: { flagId: v.id("flags") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const flag = await ctx.db.get("flags", args.flagId);
    if (flag && flag.status === "open") {
      await ctx.db.patch("flags", args.flagId, { status: "acked", ackedAt: Date.now() });
    }
    return null;
  },
});

export const flags = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(schema.doc("flags")),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("flags")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(50);
  },
});

const moveType = v.union(
  v.literal("cue"), // free-form: "jump in with your best contribution"
  v.literal("introduce"), // session greeting — the therapist speaks first, then cues this
  v.literal("draw_out"), // named invite (always ladder level 2 — the therapist chose to name them)
  v.literal("affirm"),
  v.literal("link"),
  v.literal("cut_off"),
  v.literal("block"),
);

export const requestMove = mutation({
  args: {
    sessionId: v.id("sessions"),
    move: moveType,
    targetParticipantId: v.optional(v.id("participants")),
    cueText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") throw new Error("Session is not active.");
    if (session.agentMuted) throw new Error("Brio is muted — unmute first.");
    if (args.targetParticipantId) {
      const target = await ctx.db.get("participants", args.targetParticipantId);
      if (!target || target.sessionId !== args.sessionId || target.role !== "child") {
        throw new Error("Invalid target.");
      }
    }
    const needsTarget = ["draw_out", "affirm", "link", "cut_off"].includes(args.move);
    if (needsTarget && !args.targetParticipantId) throw new Error("Pick a child first.");
    if (args.move === "introduce") {
      const rows = await ctx.db
        .query("agentIntents")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .take(200);
      if (rows.some((r) => r.type === "introduce" && r.state !== "canceled")) {
        throw new Error("Brio has already been introduced.");
      }
    }

    const action = args.move === "cue" ? "respond_to_cue" : args.move;
    const wake: Wake = {
      source: "therapist",
      menu: [action],
      reasonCode: args.move === "cue" ? "cue" : "move",
      recommendation:
        args.move === "cue"
          ? "The therapist cued you to jump in right now."
          : `The therapist asked for a "${args.move}" move right now. Do it.`,
      targetParticipantId: args.targetParticipantId,
      ladderLevel: args.move === "draw_out" ? 2 : undefined,
      cueText: args.cueText?.trim() || undefined,
    };
    await ctx.scheduler.runAfter(0, internal.engine.actor, { sessionId: args.sessionId, wake });
    return null;
  },
});
