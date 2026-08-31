// Intent lifecycle: pending → executed | canceled. Every transition is a
// guarded mutation that succeeds only while the row is still pending, so an
// approve racing a cancel (or an auto-execute) is decided atomically by the
// database — whoever commits first wins, the loser becomes a no-op.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import schema from "./schema";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Therapist taps ✓ on a card. Works in both dials. */
export const approve = mutation({
  args: { intentId: v.id("agentIntents") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("agentIntents", args.intentId);
    if (!intent || intent.state !== "pending") return { ok: false as const };
    const session = await ctx.db.get("sessions", intent.sessionId);
    if (!session || session.status !== "active" || session.agentMuted) {
      return { ok: false as const };
    }
    await ctx.db.patch("agentIntents", args.intentId, {
      state: "executed",
      resolvedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Therapist taps ✕ on a card (the veto). */
export const cancel = mutation({
  args: { intentId: v.id("agentIntents") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("agentIntents", args.intentId);
    if (!intent || intent.state !== "pending") return { ok: false as const };
    await ctx.db.patch("agentIntents", args.intentId, {
      state: "canceled",
      cancellationReason: "therapist",
      resolvedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Scheduled when an intent is born: immediately for therapist-initiated
 * moves (their tap was the approval), after the veto window when autonomous.
 * Every guard re-checks live state at fire time — a dial flipped to
 * suggest-only mid-window, a mute, or a session end all stop execution. */
export const autoExecute = internalMutation({
  args: { intentId: v.id("agentIntents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("agentIntents", args.intentId);
    if (!intent || intent.state !== "pending") return null;
    const session = await ctx.db.get("sessions", intent.sessionId);
    if (!session || session.status !== "active") return null;
    if (session.agentMuted) {
      await ctx.db.patch("agentIntents", args.intentId, {
        state: "canceled",
        cancellationReason: "muted",
        resolvedAt: Date.now(),
      });
      return null;
    }
    if (intent.source === "engine" && session.agentAutonomyDial === "suggest-only") {
      return null; // card stays pending; only a therapist tap executes it
    }
    await ctx.db.patch("agentIntents", args.intentId, {
      state: "executed",
      resolvedAt: Date.now(),
    });
    return null;
  },
});

/** The worker reports a line was actually played to the room. `executed`
 * means the decision was final; `voicedAt` means children really heard it —
 * the gap between the two is where yields live. */
export const markVoiced = mutation({
  args: { intentId: v.id("agentIntents"), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("agentIntents", args.intentId);
    if (!intent || intent.state !== "executed" || intent.voicedAt !== undefined) return null;
    await ctx.db.patch("agentIntents", args.intentId, { voicedAt: args.at });
    return null;
  },
});

/** The worker gives an unspoken line back: the floor never opened inside its
 * budget. The moment has passed — the engine will decide fresh later. */
export const yieldIntent = mutation({
  args: { intentId: v.id("agentIntents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("agentIntents", args.intentId);
    if (!intent || intent.state !== "executed" || intent.voicedAt !== undefined) return null;
    await ctx.db.patch("agentIntents", args.intentId, {
      state: "canceled",
      cancellationReason: "yielded",
      resolvedAt: Date.now(),
    });
    return null;
  },
});

/** Shared helper: drop every pending card (mute, session end). */
export async function cancelAllPending(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  reason: "muted" | "stale",
) {
  const pending = await ctx.db
    .query("agentIntents")
    .withIndex("by_sessionId_and_state", (q) => q.eq("sessionId", sessionId).eq("state", "pending"))
    .take(50);
  for (const intent of pending) {
    await ctx.db.patch("agentIntents", intent._id, {
      state: "canceled",
      cancellationReason: reason,
      resolvedAt: Date.now(),
    });
  }
}

/** Therapist panel feed: cards + recent history. do_nothing rows are audit
 * only and never displayed here — see `audit` for the review page. */
export const feed = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(schema.doc("agentIntents")),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(80);
    return rows.filter((r) => r.type !== "do_nothing").slice(0, 30);
  },
});

/** Has the therapist handed the room to Brio yet? Drives the tile button and
 * the panel hint; the engine derives the same fact for its gate. */
export const hasIntroduced = query({
  args: { sessionId: v.id("sessions") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(200);
    return rows.some((r) => r.type === "introduce" && r.state !== "canceled");
  },
});

/** Everything, do_nothing included — the review page's debug feed. */
export const audit = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(schema.doc("agentIntents")),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentIntents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(300);
  },
});
