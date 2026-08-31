// The deterministic reflexes. Pure decision logic: given current stats,
// produce at most ONE wake for the actor (or null). No database, no clock —
// everything comes in as arguments, so this unit-tests keylessly.
//
// Division of labor (deliberate): the engine detects MOMENTS and enforces
// arithmetic (airtime, cooldowns, ceilings, eligibility); judgment calls that
// need transcript semantics — like who should share next in a round — go to
// the actor, which reads the full timeline. Constraints still re-check
// whatever it returns.
import type { Doc, Id } from "../_generated/dataModel";
import type { ChildStats } from "./participation";
import {
  AFFIRM_FRESH_MS,
  BRIO_GRACE_MS,
  CHILD_COOLDOWN_MS,
  DEFICIT_THRESHOLD,
  DEFICIT_WARMUP_MS,
  DOMINANCE_FACTOR,
  ENGINE_MIN_GAP_MS,
  FOLLOWUP_TARGET_COOLDOWN_MS,
  GROUP_IDLE_MS,
  IDLE_COOLDOWN_MS,
  PASS_COOLOFF_MS,
  PROMPT_CEILING,
  ROUND_COOLDOWN_MS,
  SILENT_MS,
  THOUGHT_GAP_MS,
} from "./constants";

export type IntentType = Doc<"agentIntents">["type"];

export type Wake = {
  source: "engine" | "therapist";
  menu: IntentType[]; // the only actions the actor may pick
  recommendation: string; // human sentence, goes into the prompt and the card
  reasonCode:
    | "first_share"
    | "dominance"
    | "round"
    | "followup"
    | "deficit"
    | "silent"
    | "idle"
    | "cue"
    | "move";
  targetParticipantId?: Id<"participants">; // absent on round wakes: the actor picks
  ladderLevel?: 0 | 1 | 2;
  cueText?: string; // therapist's free-text instruction, cue only
};

export function evaluateTriggers(args: {
  session: Doc<"sessions">;
  children: ChildStats[];
  /** when Brio's introduce executed — null means no handoff yet: engine stays silent */
  introducedAt: number | null;
  /** most recent engine intent of any type, do_nothing included */
  lastEngineIntentAt: number | null;
  /** most recent executed engine re_engage */
  lastReEngageAt: number | null;
  /** any engine intent still pending? then stay quiet */
  hasPendingEngineIntent: boolean;
  /** latest activity across ALL participants (utterance/action/airtime) */
  lastAnyActivityAt: number | null;
  /** when the most recent utterance in the room ended (floor-turnover signal) */
  lastUtteranceEndAt: number | null;
  /** when Brio's most recent VOICED intent executed (any source; L1 excluded) */
  lastBrioVoicedAt: number | null;
  /** Brio's last voiced move was a group re_engage that got zero speech back */
  lastReEngageUnanswered: boolean;
  /** most recent executed suggest_to_therapist (panel notes get spacing too) */
  lastSuggestionAt: number | null;
  /** per child: time of the most recent engine intent aimed at them (do_nothing excluded, any state) */
  lastTargetedAt: Map<string, number>;
  /** per child: when they last PASSED (short "pass" utterance, or a "Pass" selection answer) */
  passedAt: Map<string, number>;
  now: number;
}): Wake | null {
  const {
    session,
    children,
    introducedAt,
    lastEngineIntentAt,
    lastReEngageAt,
    hasPendingEngineIntent,
    lastAnyActivityAt,
    lastUtteranceEndAt,
    lastBrioVoicedAt,
    lastReEngageUnanswered,
    lastSuggestionAt,
    lastTargetedAt,
    passedAt,
    now,
  } = args;

  if (session.status !== "active" || session.agentMuted) return null;
  // The handoff gate: until the therapist hands the room over (Brio's
  // introduce executes), the engine proposes NOTHING. Brio sits silently,
  // building the ledger. Therapist-initiated moves bypass this by design.
  if (introducedAt === null) return null;
  if (hasPendingEngineIntent) return null;
  if (lastEngineIntentAt !== null && now - lastEngineIntentAt < ENGINE_MIN_GAP_MS) return null;
  // Never plan a move while a thought may still be in flight: the room must
  // have been quiet since the last utterance ended (small jitter allowance —
  // the wake check is scheduled THOUGHT_GAP_MS after each final). Note this
  // is only about DECIDING: whether the room truly has space for a line is
  // the worker's delivery gate, which sees the live floor.
  if (lastUtteranceEndAt !== null && now - lastUtteranceEndAt < THOUGHT_GAP_MS - 400) return null;
  // After Brio speaks it is waiting for an answer. The grace ends EARLY the
  // moment any child responds — an answer (a share, a reaction, even a pass)
  // is the floor handing back, and dwelling after it reads as dead air. Only
  // true silence runs the clock out. Reacting to a child (first_share) and
  // panel-only advice (dominance) stay exempt as before.
  const brioGraceActive =
    lastBrioVoicedAt !== null &&
    now - lastBrioVoicedAt < BRIO_GRACE_MS &&
    (lastAnyActivityAt === null || lastAnyActivityAt <= lastBrioVoicedAt);

  // Weight 0 means "never targeted" — those children are invisible to every
  // trigger, including dominance.
  const eligible = children.filter((c) => c.weight > 0);
  const sinceTargeted = (c: ChildStats) => now - (lastTargetedAt.get(c.participantId) ?? 0);
  // A pass is FINAL for a while: the child opted out, and no trigger may put
  // them back on the spot until the cool-off lapses. (The hard constraint at
  // commit time enforces the same rule against the model's own choices.)
  const passed = (c: ChildStats) => {
    const at = passedAt.get(c.participantId);
    return at !== undefined && now - at < PASS_COOLOFF_MS;
  };
  const passedNames = eligible.filter(passed).map((c) => c.name);
  const passNote =
    passedNames.length > 0
      ? ` NOTE: ${passedNames.join(", ")} passed — accepting a pass gracefully means NOT inviting them again or revisiting what they passed on.`
      : "";

  // 1. First share: a child just spoke for the very first time — worth a warm,
  // non-evaluative acknowledgement while the moment is fresh.
  const firstShare = eligible.find((c) => {
    if (passed(c)) return false; // a first "share" that was a decline gets space, not a spotlight
    if (c.totalUtteranceCount !== 1 || c.lastUtteranceAt === null) return false;
    if (now - c.lastUtteranceAt >= AFFIRM_FRESH_MS) return false;
    // Answering OUR invite is the most natural affirm moment — the only block
    // is a kid we targeted who hasn't actually spoken since.
    const t = lastTargetedAt.get(c.participantId);
    return t === undefined || c.lastUtteranceAt > t;
  });
  if (firstShare) {
    return {
      source: "engine",
      menu: ["affirm", "do_nothing"],
      reasonCode: "first_share",
      targetParticipantId: firstShare.participantId,
      recommendation: `${firstShare.name} just shared for the first time this session. A one-sentence, non-evaluative acknowledgement would land well — or stay quiet if the group already responded.`,
    };
  }

  // 2. Dominance: never voiced at the child — panel suggestion only.
  const dominant = eligible.find(
    (c) =>
      c.expectedShare > 0 &&
      c.windowShare > c.expectedShare * DOMINANCE_FACTOR &&
      c.windowAirtimeMs > 45_000 && // ignore tiny samples
      sinceTargeted(c) >= CHILD_COOLDOWN_MS,
  );
  if (dominant) {
    return {
      source: "engine",
      menu: ["suggest_to_therapist", "do_nothing"],
      reasonCode: "dominance",
      targetParticipantId: dominant.participantId,
      recommendation: `${dominant.name} has used ${Math.round(dominant.windowShare * 100)}% of recent airtime (expected ~${Math.round(dominant.expectedShare * 100)}%). Consider a quiet suggestion to the therapist about rebalancing — never call this out to the child.`,
    };
  }

  // 3. The round: Brio is leading this exercise. While some kids haven't been
  // heard since the handoff and the floor is free, hand the actor the moment —
  // IT picks who goes next (it can read the transcript; we can't), within the
  // eligibility the constraints enforce.
  const notYetHeard = eligible.filter(
    (c) =>
      !passed(c) &&
      (c.lastUtteranceAt === null || c.lastUtteranceAt <= introducedAt) &&
      c.promptsUsed < PROMPT_CEILING &&
      sinceTargeted(c) >= ROUND_COOLDOWN_MS,
  );
  if (notYetHeard.length > 0 && !brioGraceActive) {
    const names = notYetHeard.map((c) => c.name).join(", ");
    return {
      source: "engine",
      menu: ["draw_out", "affirm", "link", "re_engage", "do_nothing"],
      reasonCode: "round",
      ladderLevel: 2, // a round invite is named, with the pass explicit
      recommendation: `You are leading this exercise and the floor is free. Not heard from since you opened the round: ${names}. Usually the right move is a warm named invite (draw_out) to ONE of them — pick whoever the conversation points to, offer the pass. If someone just finished something big, a brief affirm or link first is fine; if the group is mid-chat on its own, do_nothing.${passNote}`,
    };
  }

  // 3.5 The follow-up phase: EVERYONE has been heard at least once, but a real
  // group doesn't stop there — and neither does a facilitator. When the floor
  // has been free a while, hand the actor the moment with the full menu: a
  // named follow-up on something a child shared, a link between two shares, a
  // late affirm, a fresh angle on the exercise — or staying quiet.
  // No timers of its own: the follow-up phase obeys the same three rules as
  // everything else — thought-gap debounce, min-gap, and grace-until-response.
  const everyHeard =
    eligible.length > 0 &&
    eligible.every((c) => c.lastUtteranceAt !== null && c.lastUtteranceAt > introducedAt);
  if (everyHeard && !brioGraceActive) {
    const quietFor = Math.round((now - (lastUtteranceEndAt ?? now)) / 1000);
    // A child whose last invite went unanswered may not be re-targeted —
    // re-asking an ignored question is pressure, not facilitation.
    const responsive = eligible.filter((c) => {
      if (passed(c)) return false; // a pass is final for a while
      if (c.promptsUsed >= PROMPT_CEILING) return false; // 3 targeted invites max, per session
      if (sinceTargeted(c) < FOLLOWUP_TARGET_COOLDOWN_MS) return false; // no drilling one kid
      const t = lastTargetedAt.get(c.participantId);
      return t === undefined || (c.lastUtteranceAt !== null && c.lastUtteranceAt > t);
    });
    const unansweredNote = lastReEngageUnanswered
      ? " Your last group prompt got no answer, so another activity is OFF the menu — a quiet word to the therapist or silence are the moves now."
      : "";
    const recentSuggestion = lastSuggestionAt !== null && now - lastSuggestionAt < 90_000;
    const trim = (menu: IntentType[]) =>
      menu.filter(
        (m) =>
          (m !== "re_engage" || !lastReEngageUnanswered) &&
          (m !== "suggest_to_therapist" || !recentSuggestion),
      );
    if (responsive.length > 0) {
      return {
        source: "engine",
        menu: trim(["draw_out", "link", "affirm", "re_engage", "suggest_to_therapist", "do_nothing"]),
        reasonCode: "followup",
        ladderLevel: 2,
        recommendation: `Everyone has shared at least once and the room has gone quiet for ${quietFor}s. Keep the exercise ALIVE and VARIED — do not fall back on another generic group prompt. Follow-up candidates (spoke since their last invite, or never invited): ${responsive.map((c) => c.name).join(", ")} — ONLY these may be targeted. Best moves: invite one of them by name to say MORE about the specific thing they shared, or link two children's shares, or affirm something never acknowledged. If the exercise feels complete, celebrate it in one line and suggest_to_therapist that the round is done. Never repeat a shape or question you already used.${unansweredNote}${passNote}`,
      };
    }
    const reducedMenu = trim(["re_engage", "suggest_to_therapist", "do_nothing"]);
    if (reducedMenu.length === 1) return null; // only silence left — skip the call entirely
    return {
      source: "engine",
      menu: reducedMenu,
      reasonCode: "followup",
      recommendation: lastReEngageUnanswered
        ? `The room is quiet (${quietFor}s), no child should be put on the spot, and your last group prompt got no answer — another activity would just be noise. Quietly tell the therapist the room may need them or a new exercise (suggest_to_therapist), or do_nothing and give the room space.${passNote}`
        : `The room is quiet (${quietFor}s) and no child should be put on the spot right now (they passed, went unresponsive, or have had their share of invites). Either change the energy with ONE fresh, different group angle (re_engage), or quietly tell the therapist the room may need them or a new exercise (suggest_to_therapist) — or do_nothing and give the room space.${passNote}`,
    };
  }

  // 4. Quiet child (equity, outside the round): silent too long, or far below
  // their weighted share. Gentle ladder applies (unnamed cue first).
  const totalAirtime = children.reduce((s, c) => s + c.airtimeMs, 0);
  const candidates = eligible.filter(
    (c) =>
      !passed(c) &&
      c.promptsUsed < PROMPT_CEILING &&
      sinceTargeted(c) >= CHILD_COOLDOWN_MS &&
      (c.silentForMs > SILENT_MS ||
        (totalAirtime >= DEFICIT_WARMUP_MS && c.deficit > DEFICIT_THRESHOLD)),
  );
  if (candidates.length > 0 && !brioGraceActive) {
    const quietest = candidates.reduce((a, b) => (a.silentForMs >= b.silentForMs ? a : b));
    const level = quietest.ladderLevel;
    const levelText =
      level === 0
        ? "level 0: an unnamed cue to the WHOLE group (do not say any child's name)"
        : level === 1
          ? "level 1: a private on-screen choice for them (write the on-screen text; it is not spoken)"
          : "level 2: a gentle spoken invite by name that explicitly offers a pass";
    return {
      source: "engine",
      menu: ["draw_out", "do_nothing"],
      reasonCode: quietest.silentForMs > SILENT_MS ? "silent" : "deficit",
      targetParticipantId: quietest.participantId,
      ladderLevel: level,
      recommendation: `${quietest.name} has drifted quiet (${Math.round(quietest.silentForMs / 1000)}s since they did anything; share ${Math.round(quietest.share * 100)}%, expected ~${Math.round(quietest.expectedShare * 100)}%). Recommended: draw out at ${levelText}.`,
    };
  }

  // 5. Whole-room idle: keep the exercise moving.
  // (Once everyone has been heard, the follow-up phase above owns quiet
  // moments — this bare re-engage only covers the earlier stretch.)
  const idleSince = Math.max(lastAnyActivityAt ?? 0, lastBrioVoicedAt ?? 0, introducedAt);
  if (
    !everyHeard &&
    !brioGraceActive &&
    !lastReEngageUnanswered && // its only voice IS a re_engage

    now - idleSince > GROUP_IDLE_MS &&
    (lastReEngageAt === null || now - lastReEngageAt > IDLE_COOLDOWN_MS)
  ) {
    return {
      source: "engine",
      menu: ["re_engage", "do_nothing"],
      reasonCode: "idle",
      recommendation: `The room has been quiet for ${Math.round((now - idleSince) / 1000)}s. A short, playful group prompt tied to the exercise could restart things — or stay quiet if the pause feels natural.`,
    };
  }

  return null;
}
