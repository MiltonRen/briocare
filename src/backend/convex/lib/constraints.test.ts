// Hard-constraint tests: the deterministic gate between model output and the
// intent table. Includes the empirically observed failure from Spike B (a
// level-0 group cue written as a named invite).
import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { checkDecision, type ActorDecision } from "./constraints";
import type { Wake } from "./triggers";
import { UTTERANCE_MAX_CHARS } from "./constants";

const MAYA = "maya1" as Id<"participants">;
const LEO = "leo1" as Id<"participants">;
const eligibleTargets = new Map<string, string>([
  [MAYA, "Maya"],
  [LEO, "Leo"],
]);

const drawOutWake = (level: 0 | 1 | 2): Wake => ({
  source: "engine",
  menu: ["draw_out", "do_nothing"],
  recommendation: "",
  reasonCode: "silent",
  targetParticipantId: MAYA,
  ladderLevel: level,
});

const decision = (over: Partial<ActorDecision>): ActorDecision => ({
  action: "draw_out",
  targetParticipantId: MAYA,
  utterance: "I'd love to hear a favorite from someone who hasn't gone yet!",
  reason: "quietest child",
  ...over,
});

describe("checkDecision", () => {
  test("action must come from the menu", () => {
    const r = checkDecision({
      decision: decision({ action: "cut_off" }),
      wake: drawOutWake(2),
      eligibleTargets,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto).toContain("not on the menu");
  });

  test("the Spike-B failure: a level-0 group cue naming a child is vetoed", () => {
    const r = checkDecision({
      decision: decision({ utterance: "Maya, would you like to share yours?" }),
      wake: drawOutWake(0),
      eligibleTargets,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto).toContain("contains a child's name");
  });

  test("the same named line is fine at level 2", () => {
    const r = checkDecision({
      decision: decision({ utterance: "Maya, want to share yours? Totally fine to pass!" }),
      wake: drawOutWake(2),
      eligibleTargets,
    });
    expect(r.ok).toBe(true);
  });

  test("the actor may not retarget away from the trigger's pick", () => {
    const r = checkDecision({
      decision: decision({ targetParticipantId: LEO }),
      wake: drawOutWake(2),
      eligibleTargets,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto).toContain("retargeted");
  });

  test("a null target inherits the wake's target", () => {
    const r = checkDecision({
      decision: decision({ targetParticipantId: null }),
      wake: drawOutWake(2),
      eligibleTargets,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision.targetParticipantId).toBe(MAYA);
  });

  test("weight-0 / unknown targets are rejected", () => {
    const wake: Wake = { ...drawOutWake(2), targetParticipantId: "ghost" as Id<"participants"> };
    const r = checkDecision({ decision: decision({ targetParticipantId: null }), wake, eligibleTargets });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto).toContain("not an eligible child");
  });

  test("voiced actions require an utterance, capped in length", () => {
    const empty = checkDecision({
      decision: decision({ utterance: "  " }),
      wake: drawOutWake(2),
      eligibleTargets,
    });
    expect(empty.ok).toBe(false);
    const long = checkDecision({
      decision: decision({ utterance: "x".repeat(UTTERANCE_MAX_CHARS + 1) }),
      wake: drawOutWake(2),
      eligibleTargets,
    });
    expect(long.ok).toBe(false);
  });

  test("do_nothing normalizes: utterance and target dropped", () => {
    const r = checkDecision({
      decision: decision({ action: "do_nothing", utterance: "should vanish" }),
      wake: drawOutWake(0),
      eligibleTargets,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.utterance).toBeNull();
      expect(r.decision.targetParticipantId).toBeNull();
    }
  });

  test("re_engage may open with a named acknowledgment (bridging is legal)", () => {
    const wake: Wake = {
      source: "engine",
      menu: ["re_engage", "do_nothing"],
      recommendation: "",
      reasonCode: "idle",
    };
    const r = checkDecision({
      decision: {
        action: "re_engage",
        targetParticipantId: null,
        utterance: "Leo had a great one — who else has a favorite?",
        reason: "",
      },
      wake,
      eligibleTargets,
    });
    expect(r.ok).toBe(true); // only the level-0 INVITE keeps the name ban
  });
});
