// Non-speech participation from the kids' screens: reactions (always
// available) and selections (answers to a Brio-pushed choice — "pass" counts
// as participation too).
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { ACTION_RATE_LIMIT } from "./lib/constants";

export const recordAction = mutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    type: v.union(v.literal("reaction"), v.literal("selection")),
    details: v.optional(
      v.object({
        emoji: v.optional(v.string()),
        prompt: v.optional(v.string()),
        answer: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ counted: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status === "ended") return { counted: false };
    const participant = await ctx.db.get("participants", args.participantId);
    if (!participant || participant.sessionId !== args.sessionId) return { counted: false };

    // Rate limit: excess taps are still logged but don't move the counters,
    // so button-mashing can't game the participation ledger.
    const recent = await ctx.db
      .query("actions")
      .withIndex("by_sessionId_and_participantId", (q) =>
        q.eq("sessionId", args.sessionId).eq("participantId", args.participantId),
      )
      .order("desc")
      .take(ACTION_RATE_LIMIT.count);
    const now = Date.now();
    const limited =
      recent.length >= ACTION_RATE_LIMIT.count &&
      now - recent[recent.length - 1]._creationTime < ACTION_RATE_LIMIT.windowMs;

    await ctx.db.insert("actions", {
      sessionId: args.sessionId,
      participantId: args.participantId,
      type: args.type,
      details: args.details,
    });
    if (!limited) {
      await ctx.db.patch("participants", args.participantId, {
        actionCount: participant.actionCount + 1,
        lastActiveAt: now,
      });
    }
    return { counted: !limited };
  },
});

/** Recent reactions for the ambient overlay on everyone's screens. */
export const recentActions = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(schema.doc("actions")),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("actions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(20);
    return rows.reverse();
  },
});

/** Executed level-1 draw-outs aimed at me: the private on-screen choice.
 * The client decides freshness/dismissal; answers land via recordAction. */
export const mySelections = query({
  args: { sessionId: v.id("sessions"), participantId: v.id("participants") },
  returns: v.array(schema.doc("agentIntents")),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId_and_targetParticipantId", (q) =>
        q.eq("sessionId", args.sessionId).eq("targetParticipantId", args.participantId),
      )
      .order("desc")
      .take(10);
    return rows.filter(
      (r) => r.type === "draw_out" && r.ladderLevel === 1 && r.state === "executed",
    );
  },
});
