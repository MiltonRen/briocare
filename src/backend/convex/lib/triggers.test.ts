// Pure trigger + participation tests. No database, no keys, no clock — every
// input is fabricated, which is exactly why this logic lives in lib/.
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { deriveChildStats, type ChildStats } from "./participation";
import { evaluateTriggers } from "./triggers";
import {
  CHILD_COOLDOWN_MS,
  ENGINE_MIN_GAP_MS,
  GROUP_IDLE_MS,
  looksLikePass,
  looksLikeSoftDecline,
  PASS_COOLOFF_MS,
  PROMPT_CEILING,
  ROUND_COOLDOWN_MS,
  SILENT_MS,
  watchlistHit,
} from "./constants";

const NOW = 1_800_000_000_000; // fixed "now"
const START = NOW - 10 * 60_000; // session started 10 min ago
const HANDOFF = NOW - 8 * 60_000; // Brio was handed the room 8 min ago

const session = (over: Partial<Doc<"sessions">> = {}): Doc<"sessions"> =>
  ({
    _id: "session1" as Id<"sessions">,
    _creationTime: START,
    status: "active",
    exerciseDescription: "Share a favorite thing from this week",
    agentAutonomyDial: "autonomous",
    agentMuted: false,
    startedAt: START,
    ...over,
  }) as Doc<"sessions">;

let pCounter = 0;
const child = (over: Partial<Doc<"participants">> = {}): Doc<"participants"> =>
  ({
    _id: `child${++pCounter}` as Id<"participants">,
    _creationTime: START,
    sessionId: "session1" as Id<"sessions">,
    name: `Kid${pCounter}`,
    role: "child",
    expectedParticipationWeight: 1,
    muted: false,
    airtimeMs: 0,
    actionCount: 0,
    ...over,
  }) as Doc<"participants">;

// Defaults model a child who is engaged and was heard AFTER the handoff.
const stats = (over: Partial<ChildStats>): ChildStats => ({
  participantId: "childX" as Id<"participants">,
  name: "Kid",
  weight: 1,
  airtimeMs: 60_000,
  windowAirtimeMs: 30_000,
  share: 0.33,
  windowShare: 0.33,
  expectedShare: 0.33,
  deficit: 0,
  lastActiveAt: NOW - 10_000,
  silentForMs: 10_000,
  totalUtteranceCount: 5,
  lastUtteranceAt: NOW - 10_000,
  promptsUsed: 0,
  ladderLevel: 0,
  ...over,
});

const base = {
  session: session(),
  introducedAt: HANDOFF as number | null,
  lastEngineIntentAt: null as number | null,
  lastReEngageAt: null as number | null,
  hasPendingEngineIntent: false,
  lastAnyActivityAt: NOW - 5_000,
  lastUtteranceEndAt: NOW - 10_000, // floor has been free for a while
  lastBrioVoicedAt: null as number | null,
  lastReEngageUnanswered: false,
  lastSuggestionAt: null as number | null,
  lastTargetedAt: new Map<string, number>(),
  passedAt: new Map<string, number>(),
  now: NOW,
};

describe("the handoff gate", () => {
  test("before the therapist hands the room over, the engine NEVER wakes", () => {
    const desperate = stats({ silentForMs: SILENT_MS * 5, lastUtteranceAt: null });
    expect(
      evaluateTriggers({ ...base, introducedAt: null, children: [desperate] }),
    ).toBeNull();
    expect(
      evaluateTriggers({
        ...base,
        introducedAt: null,
        children: [desperate],
        lastAnyActivityAt: NOW - GROUP_IDLE_MS * 4, // even a dead-idle room
      }),
    ).toBeNull();
  });

  test("no wake while a thought may still be in flight (floor not yet free)", () => {
    const unheard = stats({ lastUtteranceAt: null });
    expect(
      evaluateTriggers({ ...base, children: [unheard], lastUtteranceEndAt: NOW - 800 }),
    ).toBeNull();
  });

});

describe("the round (Brio leading)", () => {
  test("kids not heard since handoff → facilitation wake; the ACTOR picks the target", () => {
    const heard = stats({ name: "Maya" });
    const unheard = stats({
      participantId: "leo" as Id<"participants">,
      name: "Leo",
      lastUtteranceAt: null,
      totalUtteranceCount: 0,
    });
    const wake = evaluateTriggers({ ...base, children: [heard, unheard] });
    expect(wake?.reasonCode).toBe("round");
    expect(wake?.targetParticipantId).toBeUndefined(); // transcript semantics → actor's call
    expect(wake?.ladderLevel).toBe(2); // round invites are named, with the pass explicit
    expect(wake?.menu).toContain("draw_out");
    expect(wake?.menu).toContain("do_nothing");
    expect(wake?.recommendation).toContain("Leo");
    expect(wake?.recommendation).not.toContain("Maya,"); // only unheard kids are listed
  });

  test("speech from BEFORE the handoff doesn't count as heard", () => {
    const spokeEarly = stats({ lastUtteranceAt: HANDOFF - 60_000 });
    const wake = evaluateTriggers({ ...base, children: [spokeEarly] });
    expect(wake?.reasonCode).toBe("round");
  });

  test("after Brio speaks, the floor belongs to the kids (grace period)", () => {
    const unheard = stats({ lastUtteranceAt: null });
    // mid-grace: no round invite, no idle re-engage
    expect(
      evaluateTriggers({ ...base, children: [unheard], lastBrioVoicedAt: NOW - 5_000 }),
    ).toBeNull();
    expect(
      evaluateTriggers({
        ...base,
        children: [stats({})],
        lastAnyActivityAt: NOW - GROUP_IDLE_MS * 3,
        lastBrioVoicedAt: NOW - 5_000,
      }),
    ).toBeNull();
    // grace passed → the round resumes
    expect(
      evaluateTriggers({ ...base, children: [unheard], lastBrioVoicedAt: NOW - 20_000 })
        ?.reasonCode,
    ).toBe("round");
    // reacting to a child's FIRST share is exempt — affirms stay timely
    const newVoice = stats({ totalUtteranceCount: 1, lastUtteranceAt: NOW - 3_000 });
    expect(
      evaluateTriggers({ ...base, children: [newVoice], lastBrioVoicedAt: NOW - 5_000 })?.menu,
    ).toEqual(["affirm", "do_nothing"]);
  });

  test("round invites respect their own short per-child cooldown", () => {
    const unheard = stats({
      participantId: "leo" as Id<"participants">,
      lastUtteranceAt: null,
    });
    expect(
      evaluateTriggers({
        ...base,
        children: [unheard],
        lastTargetedAt: new Map([["leo", NOW - ROUND_COOLDOWN_MS / 2]]),
      }),
    ).toBeNull();
  });

  test("once everyone has been heard, the round yields to the follow-up phase", () => {
    const wake = evaluateTriggers({ ...base, children: [stats({}), stats({})] });
    expect(wake?.reasonCode).toBe("followup"); // full menu incl. do_nothing — the actor judges
  });

  test("everyone heard + a quiet floor → follow-up wake with the FULL menu", () => {
    const wake = evaluateTriggers({
      ...base,
      children: [stats({ name: "Maya" }), stats({ name: "Leo" })],
      lastUtteranceEndAt: NOW - 20_000, // quiet past the follow-up threshold
      lastAnyActivityAt: NOW - 20_000,
    });
    expect(wake?.reasonCode).toBe("followup");
    expect(wake?.targetParticipantId).toBeUndefined(); // actor's pick
    expect(wake?.ladderLevel).toBe(2);
    expect(wake?.menu).toEqual([
      "draw_out",
      "link",
      "affirm",
      "re_engage",
      "suggest_to_therapist",
      "do_nothing",
    ]);
  });

  test("grace ends when a child RESPONDS — only true silence runs the clock", () => {
    const kids = [stats({}), stats({})];
    // Brio spoke 5s ago and nobody has responded → still their turn to answer
    expect(
      evaluateTriggers({
        ...base,
        children: kids,
        lastUtteranceEndAt: NOW - 30_000,
        lastAnyActivityAt: NOW - 30_000,
        lastBrioVoicedAt: NOW - 5_000,
      }),
    ).toBeNull();
    // ...but a response 3s ago (a share, a reaction, a pass) hands the floor
    // back: the same 5s-old grace no longer blocks
    expect(
      evaluateTriggers({
        ...base,
        children: kids,
        lastUtteranceEndAt: NOW - 3_000,
        lastAnyActivityAt: NOW - 3_000,
        lastBrioVoicedAt: NOW - 5_000,
      })?.reasonCode,
    ).toBe("followup");
    // and dead air past the grace frees the engine too
    expect(
      evaluateTriggers({
        ...base,
        children: kids,
        lastUtteranceEndAt: NOW - 30_000,
        lastAnyActivityAt: NOW - 30_000,
        lastBrioVoicedAt: NOW - 13_000,
      })?.reasonCode,
    ).toBe("followup");
  });

  test("a pass is final: the child disappears from every targeting trigger", () => {
    const passedKid = stats({
      participantId: "kay" as Id<"participants">,
      name: "Kay",
      lastUtteranceAt: NOW - 10_000, // she "spoke" — but it was a pass
      totalUtteranceCount: 1, // would otherwise be a first-share affirm
    });
    const other = stats({ name: "Millie" });
    const passedMap = new Map([["kay", NOW - 10_000]]);
    // no affirm at her, and the follow-up wake may not list her
    const wake = evaluateTriggers({
      ...base,
      children: [passedKid, other],
      passedAt: passedMap,
      lastUtteranceEndAt: NOW - 20_000,
      lastAnyActivityAt: NOW - 20_000,
    });
    expect(wake?.reasonCode).toBe("followup");
    expect(wake?.recommendation).toContain("invited): Millie —"); // Kay not a candidate
    expect(wake?.recommendation).toContain("Kay passed");
    // the cool-off lapses → she becomes targetable again
    const later = evaluateTriggers({
      ...base,
      children: [stats({ ...passedKid, totalUtteranceCount: 5 })],
      passedAt: new Map([["kay", NOW - PASS_COOLOFF_MS - 1000]]),
      lastUtteranceEndAt: NOW - 20_000,
      lastAnyActivityAt: NOW - 20_000,
    });
    expect(later?.recommendation).toContain("Kay");
  });

  test("looksLikePass: short pass replies (STT's 'past' included), not stories", () => {
    expect(looksLikePass("I want to pass")).toBe(true);
    expect(looksLikePass("I said I want to pass.")).toBe(true);
    expect(looksLikePass("Pass")).toBe(true);
    expect(looksLikePass("I'm good. I'm good. I'm past.")).toBe(true); // STT garble of "pass"
    expect(looksLikePass("we drove over the mountain pass and saw a huge lake there")).toBe(false);
    expect(looksLikePass("my password is cool")).toBe(false);
  });

  test("looksLikeSoftDecline: how kids actually opt out", () => {
    expect(looksLikeSoftDecline("No. I'm good.")).toBe(true);
    expect(looksLikeSoftDecline("nah")).toBe(true);
    expect(looksLikeSoftDecline("not right now")).toBe(true);
    expect(looksLikeSoftDecline("I'm okay")).toBe(true);
    expect(looksLikeSoftDecline("I got a new bike and rode it to the park with my dad")).toBe(false);
  });

  test("a kid who ANSWERED our invite still gets their first-share affirm", () => {
    // The Boba case: invited 17s ago, responded 5s ago — affirm must fire.
    const boba = stats({
      participantId: "boba" as Id<"participants">,
      name: "Boba",
      totalUtteranceCount: 1,
      lastUtteranceAt: NOW - 5_000,
    });
    const wake = evaluateTriggers({
      ...base,
      children: [boba, stats({ lastUtteranceAt: null, participantId: "m" as Id<"participants"> })],
      lastTargetedAt: new Map([["boba", NOW - 17_000]]),
    });
    expect(wake?.menu).toEqual(["affirm", "do_nothing"]);
    expect(wake?.targetParticipantId).toBe("boba");
    // …but not if they've stayed silent since the invite
    const silentSince = evaluateTriggers({
      ...base,
      children: [stats({ ...boba, lastUtteranceAt: NOW - 25_000 })],
      lastTargetedAt: new Map([["boba", NOW - 17_000]]),
      lastUtteranceEndAt: NOW - 25_000,
    });
    expect(silentSince?.menu ?? null).not.toEqual(["affirm", "do_nothing"]);
  });

  test("one unanswered group prompt is enough — re_engage drops off every menu", () => {
    const kids = [stats({}), stats({})];
    const dead = {
      ...base,
      children: kids,
      lastUtteranceEndAt: NOW - 30_000,
      lastAnyActivityAt: NOW - 30_000,
      lastBrioVoicedAt: NOW - 15_000, // the re_engage Brio voiced into silence
      lastReEngageUnanswered: true,
    };
    // full-menu follow-up: everything BUT another group prompt
    const wake = evaluateTriggers(dead);
    expect(wake?.reasonCode).toBe("followup");
    expect(wake?.menu).not.toContain("re_engage");
    // all-unresponsive follow-up: only the therapist note or silence remain
    const wake2 = evaluateTriggers({
      ...dead,
      children: kids.map((k) => ({ ...k })),
      lastTargetedAt: new Map(kids.map((k) => [k.participantId as string, NOW - 20_000])),
    });
    expect(wake2?.menu).toEqual(["suggest_to_therapist", "do_nothing"]);
    // idle (pre-everyone-heard) is silenced too — its only voice IS a re_engage
    const shy = stats({ participantId: "shy" as Id<"participants">, lastUtteranceAt: null });
    expect(
      evaluateTriggers({
        ...dead,
        children: [stats({}), shy],
        lastTargetedAt: new Map([["shy", NOW - 10_000]]),
      }),
    ).toBeNull();
    // panel notes get spacing too: a recent suggestion + unanswered prompt
    // leaves nothing but silence — no wake, no wasted LLM call
    expect(
      evaluateTriggers({
        ...dead,
        children: dead.children.map((k) => ({ ...k })),
        lastTargetedAt: new Map(kids.map((k) => [k.participantId as string, NOW - 20_000])),
        lastSuggestionAt: NOW - 30_000,
      }),
    ).toBeNull();
    // ...but after 90s a fresh suggestion is allowed again
    expect(
      evaluateTriggers({
        ...dead,
        children: dead.children.map((k) => ({ ...k })),
        lastTargetedAt: new Map(kids.map((k) => [k.participantId as string, NOW - 20_000])),
        lastSuggestionAt: NOW - 100_000,
      })?.menu,
    ).toEqual(["suggest_to_therapist", "do_nothing"]);
  });

  test("a child who ignored their last invite can't be re-targeted; all-unresponsive → group-only menu", () => {
    // Maya spoke at NOW-40s, was invited at NOW-30s, never answered.
    const maya = stats({
      participantId: "maya" as Id<"participants">,
      name: "Maya",
      lastUtteranceAt: NOW - 40_000,
    });
    const leo = stats({
      participantId: "leo" as Id<"participants">,
      name: "Leo",
      lastUtteranceAt: NOW - 35_000,
    });
    const common = {
      ...base,
      lastUtteranceEndAt: NOW - 20_000,
      lastAnyActivityAt: NOW - 20_000,
      lastEngineIntentAt: NOW - 30_000,
      lastTargetedAt: new Map([["maya", NOW - 30_000]]),
    };
    // Leo never invited → still a candidate; Maya excluded from the list
    const wake = evaluateTriggers({ ...common, children: [maya, leo] });
    expect(wake?.reasonCode).toBe("followup");
    expect(wake?.menu).toContain("draw_out");
    expect(wake?.recommendation).toContain("Leo");
    expect(wake?.recommendation).not.toMatch(/never invited\): .*Maya/);
    // Both ignored their invites → no more named moves at all
    const wake2 = evaluateTriggers({
      ...common,
      children: [maya, leo],
      lastTargetedAt: new Map([
        ["maya", NOW - 30_000],
        ["leo", NOW - 30_000],
      ]),
    });
    expect(wake2?.reasonCode).toBe("followup");
    expect(wake2?.menu).toEqual(["re_engage", "suggest_to_therapist", "do_nothing"]);
  });
});

describe("equity triggers (outside the round)", () => {
  test("a child heard earlier but drifted silent → gentle ladder draw_out", () => {
    const drifted = stats({
      participantId: "q" as Id<"participants">,
      name: "Maya",
      lastUtteranceAt: NOW - SILENT_MS - 20_000, // after handoff, long ago
      lastActiveAt: NOW - SILENT_MS - 20_000,
      silentForMs: SILENT_MS + 20_000,
      ladderLevel: 0,
    });
    // an unheard-but-round-blocked kid keeps this out of the follow-up phase —
    // the equity ladder is the fallback path, not the main leading flow
    const shy = stats({ participantId: "shy" as Id<"participants">, lastUtteranceAt: null });
    const wake = evaluateTriggers({
      ...base,
      children: [drifted, stats({}), shy],
      lastTargetedAt: new Map([["shy", NOW - 10_000]]),
    });
    expect(wake?.menu).toEqual(["draw_out", "do_nothing"]);
    expect(wake?.reasonCode).toBe("silent");
    expect(wake?.targetParticipantId).toBe("q");
    expect(wake?.ladderLevel).toBe(0);
    expect(wake?.recommendation).toContain("WHOLE group");
  });

  test("weight 0 = never targeted, by any trigger (round included)", () => {
    const invisible = stats({
      weight: 0,
      expectedShare: 0,
      lastUtteranceAt: null,
      silentForMs: SILENT_MS * 5,
      windowShare: 0.95,
      windowAirtimeMs: 120_000,
    });
    expect(evaluateTriggers({ ...base, children: [invisible] })).toBeNull();
  });

  test("per-child equity cooldown suppresses re-targeting", () => {
    const drifted = stats({
      participantId: "q" as Id<"participants">,
      lastUtteranceAt: NOW - SILENT_MS - 20_000,
      silentForMs: SILENT_MS * 2,
    });
    const shy = stats({ participantId: "shy" as Id<"participants">, lastUtteranceAt: null });
    expect(
      evaluateTriggers({
        ...base,
        children: [drifted, shy],
        lastTargetedAt: new Map([
          ["q", NOW - CHILD_COOLDOWN_MS / 2],
          ["shy", NOW - 10_000], // round-blocked too → nothing may fire
        ]),
      }),
    ).toBeNull();
  });

  test("prompt ceiling caps draw-outs per child", () => {
    const drifted = stats({
      lastUtteranceAt: null, // would be a round candidate too
      silentForMs: SILENT_MS * 2,
      promptsUsed: PROMPT_CEILING,
    });
    expect(evaluateTriggers({ ...base, children: [drifted] })).toBeNull();
  });

  test("a pending card or a recent wake keeps the engine quiet", () => {
    const unheard = stats({ lastUtteranceAt: null });
    expect(
      evaluateTriggers({ ...base, children: [unheard], hasPendingEngineIntent: true }),
    ).toBeNull();
    expect(
      evaluateTriggers({
        ...base,
        children: [unheard],
        lastEngineIntentAt: NOW - ENGINE_MIN_GAP_MS / 2,
      }),
    ).toBeNull();
  });

  test("muted or non-active session → never wakes", () => {
    const unheard = stats({ lastUtteranceAt: null });
    expect(
      evaluateTriggers({ ...base, session: session({ agentMuted: true }), children: [unheard] }),
    ).toBeNull();
    expect(
      evaluateTriggers({ ...base, session: session({ status: "lobby" }), children: [unheard] }),
    ).toBeNull();
  });

  test("first share beats everything and recommends affirm", () => {
    const newVoice = stats({
      participantId: "n" as Id<"participants">,
      totalUtteranceCount: 1,
      lastUtteranceAt: NOW - 3_000,
    });
    const alsoUnheard = stats({ lastUtteranceAt: null });
    const wake = evaluateTriggers({ ...base, children: [alsoUnheard, newVoice] });
    expect(wake?.menu).toEqual(["affirm", "do_nothing"]);
    expect(wake?.targetParticipantId).toBe("n");
  });

  test("dominance → panel suggestion only, never a voiced move", () => {
    const dominator = stats({
      participantId: "d" as Id<"participants">,
      windowShare: 0.9,
      expectedShare: 0.33,
      windowAirtimeMs: 60_000,
    });
    const wake = evaluateTriggers({ ...base, children: [dominator, stats({}), stats({})] });
    expect(wake?.menu).toEqual(["suggest_to_therapist", "do_nothing"]);
    expect(wake?.reasonCode).toBe("dominance");
  });

  test("whole-room idle (someone still unheard, round on cooldown) → re_engage", () => {
    // idle only covers the pre-everyone-heard stretch: once all have shared,
    // the follow-up phase owns quiet moments instead.
    const kids = [
      stats({}),
      stats({ participantId: "shy" as Id<"participants">, lastUtteranceAt: null }),
    ];
    const idle = {
      ...base,
      children: kids,
      lastAnyActivityAt: NOW - GROUP_IDLE_MS - 5_000,
      lastTargetedAt: new Map([["shy", NOW - 10_000]]), // round blocked briefly
    };
    expect(evaluateTriggers(idle)?.menu).toEqual(["re_engage", "do_nothing"]);
    expect(evaluateTriggers({ ...idle, lastReEngageAt: NOW - 20_000 })).toBeNull();
  });
});

describe("deriveChildStats", () => {
  test("shares, deficit, promptsUsed and ladder escalation", () => {
    const a = child({ airtimeMs: 90_000 }); // talker
    const b = child({ airtimeMs: 10_000, lastActiveAt: NOW - 240_000 }); // quiet
    const intent = (over: Partial<Doc<"agentIntents">>): Doc<"agentIntents"> =>
      ({
        _id: `i${Math.random()}` as Id<"agentIntents">,
        _creationTime: NOW - 60_000,
        sessionId: "session1" as Id<"sessions">,
        type: "draw_out",
        source: "engine",
        state: "executed",
        reason: "",
        ...over,
      }) as Doc<"agentIntents">;

    const [sa, sb] = deriveChildStats({
      session: session(),
      participants: [a, b, child({ role: "therapist" as never })],
      recentUtterances: [],
      intents: [
        intent({ targetParticipantId: b._id, _creationTime: NOW - 120_000 }),
        intent({ targetParticipantId: b._id, _creationTime: NOW - 300_000 }),
        intent({ targetParticipantId: b._id, state: "canceled" }), // canceled → ignored entirely
      ],
      utteranceCounts: { [a._id]: 2, [b._id]: 1 },
      now: NOW,
    });

    expect(sa.share).toBeCloseTo(0.9);
    expect(sa.deficit).toBe(0);
    expect(sb.share).toBeCloseTo(0.1);
    expect(sb.expectedShare).toBeCloseTo(0.5);
    expect(sb.deficit).toBeCloseTo((0.5 - 0.1) / 0.5);
    expect(sb.promptsUsed).toBe(2); // executed draw_outs whole-session
    expect(sb.ladderLevel).toBe(1); // one executed draw_out since they were last active
    expect(sa.ladderLevel).toBe(0);
  });
});

describe("watchlist tripwire", () => {
  test("hits on phrases, case-insensitively; misses ordinary sadness", () => {
    expect(watchlistHit("sometimes I want to DIE")).toBe("want to die");
    expect(watchlistHit("my brother hits me at home")).toBe("hits me");
    expect(watchlistHit("I was so sad about my team losing")).toBeNull();
  });
});
