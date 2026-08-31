// The brain's main loop. Trigger evaluation runs on two paths: a debounced
// check shortly after each utterance lands (the "someone just finished a
// thought" moment — this is what gives Brio a human facilitator's pace), and
// a 5s tick that catches idle rooms and acts as fallback. A firing trigger
// wakes the single-call LLM actor; the actor's structured decision comes back
// through hard constraints inside one atomic commit mutation. Every decision —
// do_nothing included — lands as an agentIntents row carrying the exact
// prompt and raw model response.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { agentIntentType } from "./schema";
import { deriveChildStats, type ChildStats } from "./lib/participation";
import { evaluateTriggers, type Wake } from "./lib/triggers";
import { checkDecision, type ActorDecision } from "./lib/constraints";
import { callStructured, enumOrNull } from "./lib/llm";
import {
  ACTOR_SYSTEM,
  buildActorUser,
  buildEvaluatorUser,
  EVALUATOR_SYSTEM,
  type TimelineEvent,
} from "./lib/prompts";
import {
  DOMINANCE_WINDOW_MS,
  ENGINE_TICK_MS,
  EVALUATOR_EVERY_N_TICKS,
  DECLINE_REPLY_WINDOW_MS,
  looksLikePass,
  looksLikeSoftDecline,
  PASS_COOLOFF_MS,
  PROMPT_CEILING,
  STALE_INTENT_MS,
  THOUGHT_GAP_MS,
  VETO_WINDOW_MS,
} from "./lib/constants";

export const wakeValidator = v.object({
  source: v.union(v.literal("engine"), v.literal("therapist")),
  menu: v.array(agentIntentType),
  recommendation: v.string(),
  reasonCode: v.union(
    v.literal("first_share"),
    v.literal("dominance"),
    v.literal("round"),
    v.literal("followup"),
    v.literal("deficit"),
    v.literal("silent"),
    v.literal("idle"),
    v.literal("cue"),
    v.literal("move"),
  ),
  targetParticipantId: v.optional(v.id("participants")),
  ladderLevel: v.optional(v.number()),
  cueText: v.optional(v.string()),
});

async function loadRoom(ctx: QueryCtx, sessionId: Id<"sessions">, now: number) {
  const session = await ctx.db.get("sessions", sessionId);
  if (!session) return null;
  const participants = await ctx.db
    .query("participants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(50);
  const utteranceRows = await ctx.db
    .query("utterances")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .order("desc")
    .take(600);
  const recentUtterances = utteranceRows.filter((u) => u.endAt > now - DOMINANCE_WINDOW_MS);
  const intents = await ctx.db
    .query("agentIntents")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .order("desc")
    .take(300);
  const actions = await ctx.db
    .query("actions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .order("desc")
    .take(300);
  const utteranceCounts: Record<string, number> = {};
  for (const p of participants) {
    if (p.role !== "child") continue;
    const two = await ctx.db
      .query("utterances")
      .withIndex("by_sessionId_and_participantId", (q) =>
        q.eq("sessionId", sessionId).eq("participantId", p._id),
      )
      .take(2);
    utteranceCounts[p._id] = two.length;
  }
  const children = deriveChildStats({
    session,
    participants,
    recentUtterances,
    intents,
    utteranceCounts,
    now,
  });
  // The handoff moment: Brio's introduce has executed. Engine wakes are gated
  // on this; from here on, Brio is leading the room.
  const introducedAt = intents
    .filter((i) => i.type === "introduce" && i.state === "executed")
    .reduce<number | null>((m, i) => {
      const at = i.resolvedAt ?? i._creationTime;
      return m === null || at > m ? at : m;
    }, null);
  const lastUtteranceEndAt = utteranceRows.length > 0 ? utteranceRows[0].endAt : null;
  // A pass — "pass"/"past" out loud, a tapped "Pass" card, or a soft decline
  // ("No, I'm good") given shortly after being invited — is a hard opt-out.
  const lastInvitedAt = new Map<string, number>();
  for (const i of intents) {
    if (i.state !== "executed" || !i.targetParticipantId || i.type === "do_nothing") continue;
    const at = i.resolvedAt ?? i._creationTime;
    if (at > (lastInvitedAt.get(i.targetParticipantId) ?? 0)) {
      lastInvitedAt.set(i.targetParticipantId, at);
    }
  }
  const passedAt = new Map<string, number>();
  const lastVoluntaryAt = new Map<string, number>();
  for (const u of recentUtterances) {
    if (!u.sttOk) continue;
    const invitedAt = lastInvitedAt.get(u.participantId);
    const declinedInvite =
      looksLikeSoftDecline(u.text) &&
      invitedAt !== undefined &&
      u.startAt >= invitedAt &&
      u.startAt - invitedAt < DECLINE_REPLY_WINDOW_MS;
    if (looksLikePass(u.text) || declinedInvite) {
      if (u.endAt > (passedAt.get(u.participantId) ?? 0)) passedAt.set(u.participantId, u.endAt);
    } else if (u.endAt > (lastVoluntaryAt.get(u.participantId) ?? 0)) {
      lastVoluntaryAt.set(u.participantId, u.endAt);
    }
  }
  // A pass holds only while it is the child's LATEST word: speaking up again
  // voluntarily is opting back in, and Brio may meet them there. (Reactions
  // don't clear it — a 👍 is engagement, not "I want the floor".)
  for (const [id, at] of passedAt) {
    const spoke = lastVoluntaryAt.get(id);
    if (spoke !== undefined && spoke > at) passedAt.delete(id);
  }
  for (const a of actions) {
    if (
      a.type === "selection" &&
      /\bpass\b/i.test(a.details?.answer ?? "") &&
      a._creationTime > (passedAt.get(a.participantId) ?? 0)
    ) {
      passedAt.set(a.participantId, a._creationTime);
    }
  }
  return {
    session,
    participants,
    utteranceRows, // newest first, whole recent history (bounded read)
    recentUtterances,
    intents,
    actions,
    children,
    introducedAt,
    lastUtteranceEndAt,
    passedAt,
  };
}

/** Shared by the debounced wake check and the tick: cancel stale cards,
 * evaluate the triggers, schedule the actor if one fires. */
async function evaluateAndWake(ctx: MutationCtx, sessionId: Id<"sessions">, now: number) {
  const room = await loadRoom(ctx, sessionId, now);
  if (!room || room.session.status !== "active") return;

  // Stale-cancel: a pending card whose moment has passed (too old, or a
  // draw-out whose target spoke on their own since it was proposed).
  const stale = new Set<Id<"agentIntents">>();
  for (const i of room.intents) {
    if (i.state !== "pending") continue;
    const tooOld = now - i._creationTime > STALE_INTENT_MS;
    const targetSpoke =
      i.type === "draw_out" &&
      i.targetParticipantId !== undefined &&
      room.recentUtterances.some(
        (u) => u.participantId === i.targetParticipantId && u.endAt > i._creationTime,
      );
    if (tooOld || targetSpoke) {
      stale.add(i._id);
      await ctx.db.patch("agentIntents", i._id, {
        state: "canceled",
        cancellationReason: "stale",
        resolvedAt: now,
      });
    }
  }

  const engineIntents = room.intents.filter((i) => i.source === "engine");
  const lastEngineIntentAt = engineIntents.length > 0 ? engineIntents[0]._creationTime : null;
  const reEngages = engineIntents.filter((i) => i.type === "re_engage" && i.state === "executed");
  // "Targeted" means the child EXPERIENCED it (executed) or the therapist
  // said no to it (their veto deserves respect). A yielded/stale/muted
  // attempt never reached the room — it must not lock the child out.
  const lastTargetedAt = new Map<string, number>();
  for (const i of engineIntents) {
    if (i.type === "do_nothing" || !i.targetParticipantId) continue;
    if (i.state === "canceled" && i.cancellationReason !== "therapist") continue;
    const prev = lastTargetedAt.get(i.targetParticipantId) ?? 0;
    if (i._creationTime > prev) lastTargetedAt.set(i.targetParticipantId, i._creationTime);
  }
  const lastAnyActivityAt = room.participants.reduce<number | null>(
    (m, p) => (p.lastActiveAt !== undefined && (m === null || p.lastActiveAt > m) ? p.lastActiveAt : m),
    null,
  );
  // Brio's own last voiced line (any source; on-screen L1s don't count) —
  // after it speaks, the floor belongs to the kids for BRIO_GRACE_MS. The
  // worker stamps voicedAt when playback truly finishes; until then the
  // execute time stands in (which also keeps the engine quiet while a line
  // is still waiting at the delivery gate).
  let lastVoiced: { at: number; type: string } | null = null;
  for (const i of room.intents) {
    if (
      i.state !== "executed" ||
      i.utterance === undefined ||
      (i.type === "draw_out" && i.ladderLevel === 1) ||
      i.type === "suggest_to_therapist"
    )
      continue;
    const at = i.voicedAt ?? i.resolvedAt ?? i._creationTime;
    if (!lastVoiced || at > lastVoiced.at) lastVoiced = { at, type: i.type };
  }
  const lastBrioVoicedAt = lastVoiced?.at ?? null;
  // One unanswered group prompt is enough: if the last thing Brio voiced was
  // a re_engage and NO child has spoken since, another activity would just be
  // noise — re_engage comes off the menu until someone answers.
  const lastReEngageUnanswered =
    lastVoiced?.type === "re_engage" &&
    (room.lastUtteranceEndAt === null || room.lastUtteranceEndAt <= lastVoiced.at);
  // Same medicine for the panel: one suggestion at a time — no second note
  // to the therapist until a while passes or the room moves.
  const lastSuggestionAt = room.intents
    .filter((i) => i.type === "suggest_to_therapist" && i.state === "executed")
    .reduce<number | null>((m, i) => {
      const at = i.resolvedAt ?? i._creationTime;
      return m === null || at > m ? at : m;
    }, null);

  const wake = evaluateTriggers({
    session: room.session,
    children: room.children,
    introducedAt: room.introducedAt,
    lastEngineIntentAt,
    lastReEngageAt: reEngages.length > 0 ? reEngages[0]._creationTime : null,
    // "One card in flight" covers the delivery gate too: a line that is
    // executed but not yet voiced is still WAITING at the worker — deciding
    // another move meanwhile would queue voices back-to-back.
    hasPendingEngineIntent: engineIntents.some(
      (i) =>
        (i.state === "pending" && !stale.has(i._id)) ||
        (i.state === "executed" &&
          i.utterance !== undefined &&
          i.voicedAt === undefined &&
          !(i.type === "draw_out" && i.ladderLevel === 1) &&
          i.type !== "suggest_to_therapist" &&
          now - (i.resolvedAt ?? i._creationTime) < 30_000),
    ),
    lastAnyActivityAt,
    lastUtteranceEndAt: room.lastUtteranceEndAt,
    lastBrioVoicedAt,
    lastReEngageUnanswered,
    lastSuggestionAt,
    lastTargetedAt,
    passedAt: room.passedAt,
    now,
  });
  if (wake) {
    await ctx.scheduler.runAfter(0, internal.engine.actor, { sessionId, wake });
  }
}

/** Debounced thought-end check, scheduled THOUGHT_GAP_MS after every
 * utterance lands. If newer speech arrived meanwhile, this instance bails —
 * the newer utterance scheduled its own check. Only the check after the true
 * end of a thought reaches the triggers. */
export const wakeCheck = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const latest = await ctx.db
      .query("utterances")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    if (latest.length > 0 && now - latest[0].endAt < THOUGHT_GAP_MS - 400) return null;
    await evaluateAndWake(ctx, args.sessionId, now);
    return null;
  },
});

/** The 5s fallback pulse while a session is active: idle detection, stale
 * sweeps when nobody is talking, evaluator pacing. The chain starts in
 * sessions.start and dies when status leaves "active". */
export const tick = internalMutation({
  args: { sessionId: v.id("sessions"), n: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") return null;
    await evaluateAndWake(ctx, args.sessionId, Date.now());
    if (args.n % EVALUATOR_EVERY_N_TICKS === 0) {
      await ctx.scheduler.runAfter(0, internal.engine.evaluator, { sessionId: args.sessionId });
    }
    await ctx.scheduler.runAfter(ENGINE_TICK_MS, internal.engine.tick, {
      sessionId: args.sessionId,
      n: args.n + 1,
    });
    return null;
  },
});

/** Everything the actor's prompt needs, in one consistent snapshot: the FULL
 * session timeline (speech, reactions, selections incl. passes, Brio's own
 * executed moves), uncapped — who has shared and who goes next is transcript
 * semantics, and the actor is the one reading it. */
export const actorContext = internalQuery({
  args: { sessionId: v.id("sessions"), now: v.number() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const room = await loadRoom(ctx, args.sessionId, args.now);
    if (!room || room.session.status !== "active") return null;
    const names = new Map(room.participants.map((p) => [p._id as string, p.name]));
    const actions = room.actions;

    const events: TimelineEvent[] = [
      ...room.utteranceRows
        .filter((u) => u.sttOk && u.text.trim().length > 0)
        .map((u) => ({
          at: u.startAt,
          who: names.get(u.participantId) ?? "?",
          kind: "said" as const,
          text: u.text,
        })),
      ...actions.map((a) => ({
        at: a._creationTime,
        who: names.get(a.participantId) ?? "?",
        kind: a.type,
        text:
          a.type === "reaction"
            ? (a.details?.emoji ?? "")
            : `answered "${a.details?.answer ?? ""}" to "${a.details?.prompt ?? ""}"`,
      })),
      // Brio's ENTIRE decision history, quiet and failed moves included — the
      // actor must know what it already tried, what was never actually said
      // aloud (yielded/vetoed/stale), and why it chose silence before.
      ...room.intents.map((i) => {
        const target = i.targetParticipantId ? ` → ${names.get(i.targetParticipantId) ?? "?"}` : "";
        let text: string;
        if (i.type === "do_nothing") {
          text = `(you stayed quiet — ${i.reason})`;
        } else if (i.state === "canceled") {
          text = `(you tried ${i.type}${target}: "${i.utterance ?? i.reason}" — CANCELED (${i.cancellationReason ?? "?"}); the children never heard it)`;
        } else if (i.state === "pending") {
          text = `(pending ${i.type}${target}: "${i.utterance ?? i.reason}")`;
        } else if (i.type === "suggest_to_therapist") {
          text = `(private note to the therapist: ${i.utterance ?? i.reason})`;
        } else if (i.type === "raise_flag") {
          text = `(private safety flag to the therapist)`;
        } else if (i.type === "draw_out" && i.ladderLevel === 1) {
          text = `(on-screen card${target}: "${i.utterance ?? ""}")`;
        } else {
          text = `${i.utterance ?? i.reason}${target}`;
        }
        return {
          at: i.resolvedAt ?? i._creationTime,
          who: "Brio (you)",
          kind: i.type as string,
          text,
        };
      }),
    ].sort((a, b) => a.at - b.at);

    const therapist = room.participants.find((p) => p.role === "therapist");
    const eligible = room.participants
      .filter((p) => p.role === "child" && p.expectedParticipationWeight > 0)
      .map((p) => ({ id: p._id as string, name: p.name }));
    const preNotes: Record<string, string> = {};
    for (const p of room.participants) {
      if (p.role === "child" && p.preSessionNote) preNotes[p._id] = p.preSessionNote;
    }
    return {
      session: room.session,
      therapistName: therapist?.name ?? "the therapist",
      children: room.children,
      events,
      introducedAt: room.introducedAt,
      eligible,
      preNotes,
    };
  },
});

/** One wake → one OpenAI call → one committed decision. Failures still leave
 * an audited do_nothing row, and the trigger simply fires again later. */
export const actor = internalAction({
  args: { sessionId: v.id("sessions"), wake: wakeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const context = await ctx.runQuery(internal.engine.actorContext, {
      sessionId: args.sessionId,
      now,
    });
    if (!context) return null;
    const wake = args.wake as Wake;
    const children = context.children as ChildStats[];
    const eligible = context.eligible as { id: string; name: string }[];

    const targetName = wake.targetParticipantId
      ? (eligible.find((e) => e.id === wake.targetParticipantId)?.name ?? null)
      : null;
    const user = buildActorUser({
      session: context.session as Doc<"sessions">,
      therapistName: context.therapistName as string,
      children,
      events: context.events as TimelineEvent[],
      introducedAt: context.introducedAt as number | null,
      wake,
      targetName,
      preNotes: (context.preNotes ?? {}) as Record<string, string>,
      now,
    });
    const prompt = `${ACTOR_SYSTEM}\n\n--- user ---\n\n${user}`;

    if (!env.OPENAI_API_KEY) {
      await ctx.runMutation(internal.engine.commitDecision, {
        sessionId: args.sessionId,
        wake: args.wake,
        failure: "OPENAI_API_KEY not set — actor skipped",
        prompt,
        llmResponse: "",
      });
      return null;
    }

    const schema = {
      type: "object",
      properties: {
        action: { type: "string", enum: wake.menu },
        targetParticipantId: enumOrNull(eligible.map((e) => e.id)),
        utterance: { type: ["string", "null"] },
        reason: { type: "string" },
      },
      required: ["action", "targetParticipantId", "utterance", "reason"],
      additionalProperties: false,
    };
    try {
      const { parsed, raw, ms } = await callStructured({
        apiKey: env.OPENAI_API_KEY,
        system: ACTOR_SYSTEM,
        user,
        schemaName: "actor_decision",
        schema,
        maxTokens: 400,
      });
      console.log(`[actor] ${wake.reasonCode} decided in ${ms}ms`);
      const d = parsed as ActorDecision;
      await ctx.runMutation(internal.engine.commitDecision, {
        sessionId: args.sessionId,
        wake: args.wake,
        decision: {
          action: String(d.action),
          targetParticipantId: d.targetParticipantId ?? null,
          utterance: d.utterance ?? null,
          reason: String(d.reason ?? ""),
        },
        prompt,
        llmResponse: raw,
      });
    } catch (e) {
      console.error(`[actor] wake ${wake.reasonCode} failed:`, e);
      await ctx.runMutation(internal.engine.commitDecision, {
        sessionId: args.sessionId,
        wake: args.wake,
        failure: `actor error: ${e instanceof Error ? e.message : String(e)}`,
        prompt,
        llmResponse: "",
      });
    }
    return null;
  },
});

/** The atomic landing: hard constraints re-checked against LIVE state, then
 * exactly one intent row inserted. This is where a race (mute mid-flight,
 * dial flip, a competing pending card) gets decided — by the database.
 * Scheduling by dial: autonomous → execute now; auto-with-delay → after the
 * veto window; suggest-only → wait for the tap. Therapist moves → now. */
export const commitDecision = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    wake: wakeValidator,
    decision: v.optional(
      v.object({
        action: v.string(),
        targetParticipantId: v.union(v.string(), v.null()),
        utterance: v.union(v.string(), v.null()),
        reason: v.string(),
      }),
    ),
    failure: v.optional(v.string()),
    prompt: v.string(),
    llmResponse: v.string(),
  },
  returns: v.union(v.id("agentIntents"), v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") return null;
    const wake = { ...(args.wake as Wake) };
    const now = Date.now();
    const audit = { prompt: args.prompt, llmResponse: args.llmResponse };

    const logDoNothing = async (reason: string) =>
      await ctx.db.insert("agentIntents", {
        sessionId: args.sessionId,
        type: "do_nothing",
        source: wake.source,
        state: "executed",
        resolvedAt: now,
        reason,
        ...audit,
      });

    if (args.failure !== undefined || !args.decision) {
      return await logDoNothing(args.failure ?? "actor returned nothing");
    }
    if (session.agentMuted) {
      return await logDoNothing("vetoed: Brio was muted while the decision was in flight");
    }
    if (wake.source === "engine") {
      const pending = await ctx.db
        .query("agentIntents")
        .withIndex("by_sessionId_and_state", (q) =>
          q.eq("sessionId", args.sessionId).eq("state", "pending"),
        )
        .take(5);
      if (pending.some((p) => p.source === "engine")) {
        return await logDoNothing("superseded: another card was already pending");
      }
      // Two wakes can evaluate while one LLM call is in flight (the debounced
      // check and the tick, ~2s apart). The min-gap is re-checked HERE, where
      // mutations serialize — the second decision lands as an audited no-op.
      const recent = await ctx.db
        .query("agentIntents")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .order("desc")
        .take(10);
      const lastEngine = recent.find((i) => i.source === "engine" && i.type !== "do_nothing");
      if (lastEngine && now - lastEngine._creationTime < 10_000) {
        return await logDoNothing("superseded: another decision landed moments ago");
      }
    }

    const eligibleDocs = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    const eligibleTargets = new Map(
      eligibleDocs
        .filter((p) => p.role === "child" && p.expectedParticipationWeight > 0)
        .map((p) => [p._id as string, p.name]),
    );

    const result = checkDecision({
      decision: args.decision as ActorDecision,
      wake,
      eligibleTargets,
    });
    if (!result.ok) {
      return await logDoNothing(`constraint veto: ${result.veto}`);
    }
    const d = result.decision;
    if (d.action === "do_nothing") {
      return await logDoNothing(d.reason || "chose to stay quiet");
    }

    // Hard per-target protections, re-read from the LIVE tables (engine wakes
    // only — the therapist's explicit moves are their call). Prompt rules can
    // be ignored by a model; these cannot.
    if (wake.source === "engine" && d.targetParticipantId) {
      const target = d.targetParticipantId;
      const targetName = eligibleTargets.get(target) ?? "the child";
      const recentUtts = await ctx.db
        .query("utterances")
        .withIndex("by_sessionId_and_participantId", (q) =>
          q.eq("sessionId", args.sessionId).eq("participantId", target),
        )
        .order("desc")
        .take(10);
      const recentActs = await ctx.db
        .query("actions")
        .withIndex("by_sessionId_and_participantId", (q) =>
          q.eq("sessionId", args.sessionId).eq("participantId", target),
        )
        .order("desc")
        .take(10);
      const targeted = await ctx.db
        .query("agentIntents")
        .withIndex("by_sessionId_and_targetParticipantId", (q) =>
          q.eq("sessionId", args.sessionId).eq("targetParticipantId", target),
        )
        .take(100);
      const lastInvitedAt = targeted
        .filter((i) => i.state === "executed" && i.type !== "do_nothing")
        .reduce<number>((m, i) => Math.max(m, i.resolvedAt ?? i._creationTime), 0);
      let lastPassAt = 0;
      let lastVoluntaryAt = 0;
      for (const u of recentUtts) {
        if (!u.sttOk) continue;
        const isPass =
          looksLikePass(u.text) ||
          (looksLikeSoftDecline(u.text) &&
            u.startAt >= lastInvitedAt &&
            u.startAt - lastInvitedAt < DECLINE_REPLY_WINDOW_MS);
        if (isPass) lastPassAt = Math.max(lastPassAt, u.endAt);
        else lastVoluntaryAt = Math.max(lastVoluntaryAt, u.endAt);
      }
      for (const a of recentActs) {
        if (a.type === "selection" && /\bpass\b/i.test(a.details?.answer ?? "")) {
          lastPassAt = Math.max(lastPassAt, a._creationTime);
        }
      }
      // A later voluntary share clears the pass — they opted back in.
      const passedRecently =
        lastPassAt > 0 && now - lastPassAt < PASS_COOLOFF_MS && lastVoluntaryAt <= lastPassAt;
      if (passedRecently) {
        return await logDoNothing(
          `constraint veto: ${targetName} passed recently — a pass is final, they are off-limits`,
        );
      }
      if (d.action === "draw_out") {
        const used = targeted.filter(
          (i) => i.source === "engine" && i.type === "draw_out" && i.state === "executed",
        ).length;
        if (used >= PROMPT_CEILING) {
          return await logDoNothing(
            `constraint veto: draw-out ceiling (${PROMPT_CEILING}/session) reached for ${targetName}`,
          );
        }
      }
    }

    // suggest_to_therapist is panel-only: born executed, never voiced (the
    // worker only plays voiced types), nothing to veto.
    const bornExecuted = d.action === "suggest_to_therapist";
    const intentId = await ctx.db.insert("agentIntents", {
      sessionId: args.sessionId,
      type: d.action,
      source: wake.source,
      targetParticipantId: d.targetParticipantId ?? undefined,
      state: bornExecuted ? "executed" : "pending",
      resolvedAt: bornExecuted ? now : undefined,
      reason: d.reason,
      utterance: d.utterance ?? undefined,
      ladderLevel: d.action === "draw_out" ? (wake.ladderLevel ?? 2) : undefined,
      ...audit,
    });
    if (!bornExecuted) {
      if (wake.source === "therapist" || session.agentAutonomyDial === "autonomous") {
        await ctx.scheduler.runAfter(0, internal.intents.autoExecute, { intentId });
      } else if (session.agentAutonomyDial === "auto-with-delay") {
        await ctx.scheduler.runAfter(VETO_WINDOW_MS, internal.intents.autoExecute, { intentId });
      }
      // suggest-only: the card waits for a therapist tap (or the stale sweep).
    }
    return intentId;
  },
});

/** Lines the 10s distress sweep should look at (recent, transcribed, not
 * already flagged), with the ids the model must echo back. */
export const evaluatorContext = internalQuery({
  args: { sessionId: v.id("sessions"), now: v.number() },
  returns: v.union(
    v.array(v.object({ id: v.id("utterances"), name: v.string(), text: v.string() })),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session || session.status !== "active") return null;
    const windowMs = ENGINE_TICK_MS * EVALUATOR_EVERY_N_TICKS + 2_000;
    const rows = await ctx.db
      .query("utterances")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(30);
    const fresh = rows.filter(
      (u) => u.sttOk && u.text.trim().length > 0 && u.endAt > args.now - windowMs,
    );
    if (fresh.length === 0) return [];
    const flagged = new Set(
      (
        await ctx.db
          .query("flags")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
          .take(100)
      ).map((f) => f.utteranceId),
    );
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    const names = new Map(participants.map((p) => [p._id, p.name]));
    return fresh
      .filter((u) => !flagged.has(u._id))
      .sort((a, b) => a.startAt - b.startAt)
      .map((u) => ({ id: u._id, name: names.get(u.participantId) ?? "?", text: u.text }));
  },
});

/** The 10s safety sweep: reads recent lines, may raise a flag. Flags bypass
 * the gate (born executed) and are never voiced — panel alert only. */
export const evaluator = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const lines: { id: Id<"utterances">; name: string; text: string }[] | null =
      await ctx.runQuery(internal.engine.evaluatorContext, { sessionId: args.sessionId, now });
    if (!lines || lines.length === 0) return null;
    if (!env.OPENAI_API_KEY) return null; // keyless: the watchlist tripwire still works

    const user = buildEvaluatorUser({ lines });
    const schema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["raise_flag", "do_nothing"] },
        utteranceId: enumOrNull(lines.map((l) => l.id as string)),
        reason: { type: "string" },
      },
      required: ["action", "utteranceId", "reason"],
      additionalProperties: false,
    };
    try {
      const { parsed, raw } = await callStructured({
        apiKey: env.OPENAI_API_KEY,
        system: EVALUATOR_SYSTEM,
        user,
        schemaName: "safety_sweep",
        schema,
        maxTokens: 250,
      });
      const d = parsed as { action: string; utteranceId: string | null; reason: string };
      if (d.action === "raise_flag" && d.utteranceId) {
        await ctx.runMutation(internal.engine.commitFlag, {
          sessionId: args.sessionId,
          utteranceId: d.utteranceId,
          reason: d.reason,
          prompt: `${EVALUATOR_SYSTEM}\n\n--- user ---\n\n${user}`,
          llmResponse: raw,
        });
      }
    } catch (e) {
      console.error("[evaluator] sweep failed:", e); // no row: sweeps are cheap and frequent
    }
    return null;
  },
});

export const commitFlag = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    utteranceId: v.string(),
    reason: v.string(),
    prompt: v.string(),
    llmResponse: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const utteranceId = ctx.db.normalizeId("utterances", args.utteranceId);
    if (!utteranceId) return null;
    const utterance = await ctx.db.get("utterances", utteranceId);
    if (!utterance || utterance.sessionId !== args.sessionId) return null;
    const existing = await ctx.db
      .query("flags")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(100);
    if (existing.some((f) => f.utteranceId === utteranceId)) return null; // deduped
    await ctx.db.insert("flags", {
      sessionId: args.sessionId,
      kind: "distress",
      participantId: utterance.participantId,
      text: utterance.text,
      utteranceId,
      status: "open",
    });
    await ctx.db.insert("agentIntents", {
      sessionId: args.sessionId,
      type: "raise_flag",
      source: "engine",
      targetParticipantId: utterance.participantId,
      state: "executed",
      resolvedAt: Date.now(),
      reason: args.reason,
      prompt: args.prompt,
      llmResponse: args.llmResponse,
    });
    return null;
  },
});
