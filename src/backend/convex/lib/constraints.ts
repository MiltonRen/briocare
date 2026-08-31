// Hard constraints — the deterministic re-check between the model's output
// and the database. The actor proposes; this decides whether the proposal is
// legal. A veto becomes an audited do_nothing row, never an error.
import type { Id } from "../_generated/dataModel";
import type { IntentType, Wake } from "./triggers";
import { UTTERANCE_MAX_CHARS } from "./constants";

export type ActorDecision = {
  action: IntentType;
  targetParticipantId: string | null;
  utterance: string | null;
  reason: string;
};

const NEEDS_UTTERANCE: IntentType[] = [
  "draw_out",
  "re_engage",
  "affirm",
  "link",
  "cut_off",
  "block",
  "introduce",
  "respond_to_cue",
  "suggest_to_therapist",
];

const NEEDS_TARGET: IntentType[] = ["draw_out", "affirm", "link", "cut_off"];

// A level-0 draw-out is BY DEFINITION unnamed — that ban stays (the observed
// Spike-B failure). Group re-engages may open with a named acknowledgment
// ("Loved that, Ana! Okay friends…"), so they are no longer name-banned.
const NAME_BANNED: (wake: Wake) => IntentType[] = (wake) =>
  wake.ladderLevel === 0 ? ["draw_out"] : [];

export type ConstraintResult =
  | { ok: true; decision: ActorDecision & { targetParticipantId: Id<"participants"> | null } }
  | { ok: false; veto: string };

export function checkDecision(args: {
  decision: ActorDecision;
  wake: Wake;
  /** children eligible as targets (weight > 0), id → name */
  eligibleTargets: Map<string, string>;
}): ConstraintResult {
  const { wake, eligibleTargets } = args;
  const d = { ...args.decision };

  if (!wake.menu.includes(d.action)) {
    return { ok: false, veto: `action "${d.action}" is not on the menu [${wake.menu.join(", ")}]` };
  }

  if (d.action === "do_nothing") {
    return {
      ok: true,
      decision: { action: "do_nothing", targetParticipantId: null, utterance: null, reason: d.reason },
    };
  }

  // The actor may not retarget: the trigger picked the child.
  if (wake.targetParticipantId) {
    if (d.targetParticipantId !== null && d.targetParticipantId !== wake.targetParticipantId) {
      return { ok: false, veto: `model retargeted to ${d.targetParticipantId}; wake targeted ${wake.targetParticipantId}` };
    }
    d.targetParticipantId = wake.targetParticipantId;
  }

  if (NEEDS_TARGET.includes(d.action) && !d.targetParticipantId) {
    return { ok: false, veto: `action "${d.action}" requires a target` };
  }
  if (d.targetParticipantId && !eligibleTargets.has(d.targetParticipantId)) {
    return { ok: false, veto: `target ${d.targetParticipantId} is not an eligible child (unknown or weight 0)` };
  }

  if (NEEDS_UTTERANCE.includes(d.action)) {
    const text = d.utterance?.trim() ?? "";
    if (text.length === 0) return { ok: false, veto: `action "${d.action}" requires an utterance` };
    if (text.length > UTTERANCE_MAX_CHARS) {
      return { ok: false, veto: `utterance is ${text.length} chars (max ${UTTERANCE_MAX_CHARS})` };
    }
    d.utterance = text;
  } else {
    d.utterance = null;
  }

  // The empirically confirmed failure (Spike B, day one): a level-0 group cue
  // written as a named invite. Ban every known child name from group lines.
  if (d.utterance && NAME_BANNED(wake).includes(d.action)) {
    const lower = d.utterance.toLowerCase();
    for (const name of eligibleTargets.values()) {
      const first = name.trim().split(/\s+/)[0]?.toLowerCase();
      if (first && first.length >= 3 && lower.includes(first)) {
        return { ok: false, veto: `group line at ladder level ${wake.ladderLevel ?? "-"} contains a child's name ("${name}")` };
      }
    }
  }

  return {
    ok: true,
    decision: { ...d, targetParticipantId: (d.targetParticipantId as Id<"participants">) ?? null },
  };
}
