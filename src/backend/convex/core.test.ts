/// <reference types="vite/client" />
// Keyless integration tests: real Convex functions against an in-memory
// backend (convex-test). No network — the actor takes its no-key fallback
// path, which still exercises the full trigger → actor → commit wiring.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { ENGINE_TICK_MS, THOUGHT_GAP_MS, VETO_WINDOW_MS } from "./lib/constants";
import type { Wake } from "./lib/triggers";

const modules = import.meta.glob("./**/*.ts");

const newTest = () => convexTest(schema, modules);

async function seedActiveSession(t: ReturnType<typeof convexTest>) {
  const { sessionId, participantId: therapistId } = await t.mutation(api.sessions.create, {
    exerciseDescription: "Share one favorite thing from this week",
    therapistName: "Dr. Rivera",
  });
  const { participantId: maya } = await t.mutation(api.sessions.join, {
    sessionId,
    name: "Maya",
  });
  const { participantId: leo } = await t.mutation(api.sessions.join, { sessionId, name: "Leo" });
  await t.mutation(api.sessions.start, { sessionId });
  return { sessionId, therapistId, maya, leo };
}

/** Fabricate the handoff: an executed introduce, as commitDecision would
 * leave it — dated past the post-speech grace so triggers can fire. */
async function handOff(t: ReturnType<typeof convexTest>, sessionId: Id<"sessions">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agentIntents", {
      sessionId,
      type: "introduce",
      source: "therapist",
      state: "executed",
      resolvedAt: Date.now() - 30_000,
      reason: "handoff",
      utterance: "Hi, I'm Brio! Who wants to share a favorite thing? Passing is okay!",
    });
  });
}

const drawOutWake = (target: Id<"participants">, level: 0 | 1 | 2): Wake => ({
  source: "engine",
  menu: ["draw_out", "do_nothing"],
  recommendation: "test wake",
  reasonCode: "silent",
  targetParticipantId: target,
  ladderLevel: level,
});

const namedInvite = (target: Id<"participants">) => ({
  action: "draw_out",
  targetParticipantId: target as string,
  utterance: "Maya, want to share yours? Totally fine to pass!",
  reason: "quiet for a while",
});

const speak = (
  sessionId: Id<"sessions">,
  participantId: Id<"participants">,
  text: string,
  startAt: number,
  endAt: number,
) => ({ sessionId, participantId, startAt, endAt, text, sttOk: true as const });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("session lifecycle", () => {
  test("create → join → start locks joins → end freezes a transcript", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);

    await expect(
      t.mutation(api.sessions.join, { sessionId, name: "Late kid" }),
    ).rejects.toThrow(/already started/);

    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "I got a new bike this week", Date.now() - 3000, Date.now() - 1000),
    );
    await t.mutation(api.sessions.end, { sessionId });

    const session = await t.query(api.sessions.get, { sessionId });
    expect(session?.status).toBe("ended");
    expect(session?.transcript).toContain("Maya: I got a new bike this week");

    // ended sessions accept no more media traffic
    await t.mutation(api.worker.bumpAirtime, {
      sessionId,
      participantId: maya,
      deltaMs: 5000,
      at: Date.now(),
    });
    const roster = await t.query(api.sessions.roster, { sessionId });
    expect(roster.find((p) => p._id === maya)?.airtimeMs).toBe(0);
  });
});

describe("merge-at-write (one row per thought)", () => {
  test("same-speaker fragments within the gap merge; a real pause splits", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    const t0 = Date.now();
    await t.mutation(api.worker.recordUtterance, speak(sessionId, maya, "And I I I think", t0, t0 + 1000));
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "I have a problem with", t0 + 1800, t0 + 3000),
    );
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "my class.", t0 + 3900, t0 + 4600),
    );
    // a real pause, longer than the thought gap → new thought, new row
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "Also one more thing!", t0 + 4600 + THOUGHT_GAP_MS + 500, t0 + 9000),
    );
    const rows = await t.query(api.sessions.captions, { sessionId });
    expect(rows.length).toBe(2);
    expect(rows[0].text).toBe("And I I I think I have a problem with my class.");
    expect(rows[0].endAt).toBe(t0 + 4600);
    expect(rows[1].text).toBe("Also one more thing!");
  });

  test("another kid interjecting doesn't break the speaker's own merge", async () => {
    const t = newTest();
    const { sessionId, maya, leo } = await seedActiveSession(t);
    const t0 = Date.now();
    await t.mutation(api.worker.recordUtterance, speak(sessionId, maya, "My teacher praised", t0, t0 + 1200));
    await t.mutation(api.worker.recordUtterance, speak(sessionId, leo, "oh no", t0 + 1300, t0 + 1700));
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "my classmate and not me.", t0 + 2000, t0 + 3400),
    );
    const rows = await t.query(api.sessions.captions, { sessionId });
    expect(rows.map((r) => r.text)).toEqual([
      "My teacher praised my classmate and not me.",
      "oh no",
    ]);
  });

  test("the tripwire catches a watchlist phrase SPLIT across fragments — one flag", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    const t0 = Date.now();
    await t.mutation(api.worker.recordUtterance, speak(sessionId, maya, "sometimes my brother hits", t0, t0 + 1500));
    await t.mutation(api.worker.recordUtterance, speak(sessionId, maya, "me a lot", t0 + 2200, t0 + 3000));
    await t.mutation(api.worker.recordUtterance, speak(sessionId, maya, "and it hurts", t0 + 3600, t0 + 4300));
    const flags = await t.query(api.therapist.flags, { sessionId });
    expect(flags.length).toBe(1); // raised once, on the merged row, deduped after
    expect(flags[0].text).toContain("hits me");
  });
});

describe("guarded intent lifecycle across the three dials", () => {
  test("autonomous (default): executes immediately — no window", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    vi.advanceTimersByTime(50);
    await t.finishInProgressScheduledFunctions();
    const feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("executed");
  });

  test("auto-with-delay: pending → auto-executes when the veto window lapses", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(api.therapist.setDial, { sessionId, dial: "auto-with-delay" });
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    let feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("pending");
    vi.advanceTimersByTime(VETO_WINDOW_MS + 500);
    await t.finishInProgressScheduledFunctions();
    feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("executed");
  });

  test("therapist cancel beats the window; auto-execute then no-ops", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(api.therapist.setDial, { sessionId, dial: "auto-with-delay" });
    const intentId = (await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    })) as Id<"agentIntents">;

    expect((await t.mutation(api.intents.cancel, { intentId })).ok).toBe(true);
    vi.advanceTimersByTime(VETO_WINDOW_MS + 500);
    await t.finishInProgressScheduledFunctions();

    const feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("canceled");
    expect(feed[0].cancellationReason).toBe("therapist");
    expect((await t.mutation(api.intents.approve, { intentId })).ok).toBe(false);
  });

  test("dial flipped to suggest-only mid-window freezes the card", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(api.therapist.setDial, { sessionId, dial: "auto-with-delay" });
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    await t.mutation(api.therapist.setDial, { sessionId, dial: "suggest-only" });
    vi.advanceTimersByTime(VETO_WINDOW_MS + 500);
    await t.finishInProgressScheduledFunctions();

    const feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("pending"); // waits for a human tap now
    expect((await t.mutation(api.intents.approve, { intentId: feed[0]._id })).ok).toBe(true);
  });

  test("the delivery gate lifecycle: executed → voiced, or given back as yielded", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    const intentId = (await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    })) as Id<"agentIntents">;
    vi.advanceTimersByTime(50);
    await t.finishInProgressScheduledFunctions(); // instant-autonomous → executed

    // the floor never opened → the worker gives the line back
    await t.mutation(api.intents.yieldIntent, { intentId });
    let feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("canceled");
    expect(feed[0].cancellationReason).toBe("yielded");
    // a yielded line can't be voiced afterwards
    await t.mutation(api.intents.markVoiced, { intentId, at: Date.now() });
    feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].voicedAt).toBeUndefined();

    // second line: gets air → voiced → a late yield is a no-op
    vi.advanceTimersByTime(11_000);
    const second = (await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    })) as Id<"agentIntents">;
    vi.advanceTimersByTime(50);
    await t.finishInProgressScheduledFunctions();
    await t.mutation(api.intents.markVoiced, { intentId: second, at: Date.now() });
    await t.mutation(api.intents.yieldIntent, { intentId: second });
    feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("executed");
    expect(feed[0].voicedAt).toBeDefined();
  });

  test("the actor's timeline carries its WHOLE history — silence and unsaid lines included", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("agentIntents", {
        sessionId,
        type: "draw_out",
        source: "engine",
        targetParticipantId: maya,
        state: "canceled",
        cancellationReason: "yielded",
        resolvedAt: Date.now() - 30_000,
        reason: "quiet kid",
        utterance: "Maya, want to share yours?",
        ladderLevel: 2,
      });
      await ctx.db.insert("agentIntents", {
        sessionId,
        type: "do_nothing",
        source: "engine",
        state: "executed",
        resolvedAt: Date.now() - 20_000,
        reason: "the group was mid-conversation",
      });
    });
    const context = await t.query(internal.engine.actorContext, {
      sessionId,
      now: Date.now(),
    });
    expect(context).not.toBeNull();
    const texts = (context!.events as { text: string }[]).map((e) => e.text).join("\n");
    expect(texts).toContain("CANCELED (yielded); the children never heard it");
    expect(texts).toContain("you stayed quiet — the group was mid-conversation");
  });

  test("muting Brio drops pending cards and blocks new voiced commits", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(api.therapist.setDial, { sessionId, dial: "suggest-only" });
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    await t.mutation(api.therapist.setAgentMuted, { sessionId, muted: true });
    const feed = await t.query(api.intents.feed, { sessionId });
    expect(feed[0].state).toBe("canceled");
    expect(feed[0].cancellationReason).toBe("muted");

    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    const audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].type).toBe("do_nothing");
    expect(audit[0].reason).toContain("muted");
  });

  test("constraint veto lands as an audited do_nothing (the L0 name ban)", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 0), // level 0: unnamed group cue
      decision: namedInvite(maya), // ...but the model wrote a named invite
      prompt: "p",
      llmResponse: "r",
    });
    const audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].type).toBe("do_nothing");
    expect(audit[0].reason).toContain("constraint veto");
    expect(audit[0].prompt).toBe("p");
    const feed = await t.query(api.intents.feed, { sessionId });
    expect(feed.length).toBe(0);
  });
});

describe("participation plumbing", () => {
  test("action rate limit: excess taps log but stop counting", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    let counted = 0;
    for (let i = 0; i < 9; i++) {
      const r = await t.mutation(api.interactions.recordAction, {
        sessionId,
        participantId: maya,
        type: "reaction",
        details: { emoji: "🎉" },
      });
      if (r.counted) counted++;
    }
    expect(counted).toBe(6);
    const roster = await t.query(api.sessions.roster, { sessionId });
    expect(roster.find((p) => p._id === maya)?.actionCount).toBe(6);
    const review = await t.query(api.sessions.review, { sessionId });
    expect(review?.actions.length).toBe(9);
  });

  test("evaluator flags dedupe by utteranceId", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "I feel really alone", Date.now() - 2000, Date.now()),
    );
    const utteranceId = (await t.query(api.sessions.captions, { sessionId }))[0]._id;
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.engine.commitFlag, {
        sessionId,
        utteranceId,
        reason: "hopeless phrasing",
        prompt: "p",
        llmResponse: "r",
      });
    }
    expect((await t.query(api.therapist.flags, { sessionId })).length).toBe(1);
  });
});

describe("the handoff and the round", () => {
  test("before the handoff the engine proposes nothing; after it, the round wakes", async () => {
    const t = newTest();
    const { sessionId, maya, leo } = await seedActiveSession(t);
    const past = Date.now() - 10 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch("sessions", sessionId, { startedAt: past });
      await ctx.db.patch("participants", maya, { lastActiveAt: past });
      await ctx.db.patch("participants", leo, { lastActiveAt: past });
    });

    await t.mutation(internal.engine.tick, { sessionId, n: 1 });
    vi.advanceTimersByTime(100);
    await t.finishInProgressScheduledFunctions();
    let audit = await t.query(api.intents.audit, { sessionId });
    expect(audit.filter((i) => i.source === "engine").length).toBe(0); // gated

    await handOff(t, sessionId);
    await t.mutation(internal.engine.tick, { sessionId, n: 3 }); // odd n: no evaluator
    vi.advanceTimersByTime(100);
    await t.finishInProgressScheduledFunctions();
    audit = await t.query(api.intents.audit, { sessionId });
    const decision = audit.find((i) => i.source === "engine" && i.type === "do_nothing");
    expect(decision).toBeDefined(); // keyless fallback, but the wake happened
    expect(decision?.prompt).toContain("Maya"); // round lists the unheard kids
    expect(decision?.prompt).toContain("Leo");
    expect(decision?.prompt).toContain(
      "MENU (choose one): draw_out, affirm, link, re_engage, do_nothing",
    );
  });

  test("the wake check debounces: only the check after the last fragment evaluates", async () => {
    // Timing here is derived from the constants so retuning them keeps the
    // test honest: the whole debounced sequence must finish BEFORE the first
    // fallback tick, or a late-running tick wakes a second actor and the
    // "exactly one decision" claim stops isolating the debounce.
    expect(ENGINE_TICK_MS).toBeGreaterThan(THOUGHT_GAP_MS + 900); // else this test cannot dodge the tick — restructure it
    const GAP_B = 700; // second fragment lands this long after the first
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await handOff(t, sessionId);
    const t0 = Date.now(); // == session start under fake timers; tick #1 due t0+ENGINE_TICK_MS
    await t.mutation(api.worker.recordUtterance, speak(sessionId, maya, "I got", t0 - 500, t0));
    vi.advanceTimersByTime(GAP_B); // fragment lands mid-thought
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "a new bike", t0 + GAP_B - 500, t0 + GAP_B),
    );
    // run the FIRST check while the merged thought is still fresh → it bails
    // (checks run at current fake-time, so stay inside the freshness window)
    vi.advanceTimersByTime(THOUGHT_GAP_MS - GAP_B + 100); // now: t0 + THOUGHT_GAP + 100
    await t.finishInProgressScheduledFunctions();
    let audit = await t.query(api.intents.audit, { sessionId });
    expect(audit.filter((i) => i.source === "engine").length).toBe(0);
    // run the SECOND check after a real gap of silence → it wakes the actor
    // (still before tick #1: THOUGHT_GAP + GAP_B + 200 < ENGINE_TICK_MS)
    vi.advanceTimersByTime(GAP_B + 100); // now: t0 + THOUGHT_GAP + GAP_B + 200
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(50);
    await t.finishInProgressScheduledFunctions(); // run the scheduled actor
    audit = await t.query(api.intents.audit, { sessionId });
    // exactly one engine decision: the surviving check woke the actor once
    expect(audit.filter((i) => i.source === "engine").length).toBe(1);
  });

  test("a yielded attempt does not cool a child down — they were never targeted", async () => {
    const t = newTest();
    const { sessionId, maya, leo } = await seedActiveSession(t);
    await handOff(t, sessionId);
    const past = Date.now() - 10 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch("sessions", sessionId, { startedAt: past });
      await ctx.db.patch("participants", leo, { lastActiveAt: Date.now() });
      // a draw_out at Maya that YIELDED 20s ago — inside the round cooldown
      // window, but she never heard it
      await ctx.db.insert("agentIntents", {
        sessionId,
        type: "draw_out",
        source: "engine",
        targetParticipantId: maya,
        state: "canceled",
        cancellationReason: "yielded",
        resolvedAt: Date.now() - 20_000,
        reason: "earlier attempt",
        utterance: "Maya, want to share?",
        ladderLevel: 2,
      });
      await ctx.db.insert("utterances", {
        sessionId,
        participantId: leo,
        startAt: Date.now() - 40_000,
        endAt: Date.now() - 35_000,
        text: "I got a new bike",
        sttOk: true,
      });
    });
    // clear MIN_GAP from the just-inserted row, but stay inside the 25s round
    // cooldown the yielded row WOULD have imposed if it still counted
    vi.advanceTimersByTime(13_000);
    await t.mutation(internal.engine.tick, { sessionId, n: 1 });
    vi.advanceTimersByTime(100);
    await t.finishInProgressScheduledFunctions();
    const audit = await t.query(api.intents.audit, { sessionId });
    const decision = audit.find((i) => i.source === "engine" && i.type === "do_nothing");
    // the round wake fired and still lists Maya — the yielded row didn't lock her
    expect(decision?.prompt).toContain("Not heard from since you opened the round: Maya");
  });

  test("therapist moves bypass the gate; a second introduce is rejected", async () => {
    const t = newTest();
    const { sessionId } = await seedActiveSession(t);
    await t.mutation(api.therapist.requestMove, {
      sessionId,
      move: "cue",
      cueText: "Say hi to everyone!",
    }); // works pre-handoff
    vi.advanceTimersByTime(100);
    await t.finishInProgressScheduledFunctions();
    const audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].source).toBe("therapist");
    expect(audit[0].prompt).toContain("Say hi to everyone!");

    await handOff(t, sessionId);
    await expect(
      t.mutation(api.therapist.requestMove, { sessionId, move: "introduce" }),
    ).rejects.toThrow(/already been introduced/);
    expect(await t.query(api.intents.hasIntroduced, { sessionId })).toBe(true);
  });

  test("hard veto: a child who passed cannot be targeted, even if the model tries", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "I want to pass", Date.now() - 5000, Date.now() - 4000),
    );
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya), // the model drills anyway…
      prompt: "p",
      llmResponse: "r",
    });
    const audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].type).toBe("do_nothing"); // …and the constraint stops it
    expect(audit[0].reason).toContain("passed recently");
    expect((await t.query(api.intents.feed, { sessionId })).length).toBe(0);
  });

  test("hard veto: the per-child draw-out ceiling holds across every trigger path", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("agentIntents", {
          sessionId,
          type: "draw_out",
          source: "engine",
          targetParticipantId: maya,
          state: "executed",
          resolvedAt: Date.now() - 60_000 * (i + 1),
          reason: "earlier invite",
          utterance: "…",
          ladderLevel: 2,
        });
      }
    });
    vi.advanceTimersByTime(11_000); // clear the commit-time dedupe window
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    const audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].type).toBe("do_nothing");
    expect(audit[0].reason).toContain("ceiling");
  });

  test("'No, I'm good' right after an invite is a pass; without an invite it isn't", async () => {
    const t = newTest();
    const { sessionId, maya, leo } = await seedActiveSession(t);
    // Maya was invited, then softly declined → off-limits
    await t.run(async (ctx) => {
      await ctx.db.insert("agentIntents", {
        sessionId,
        type: "draw_out",
        source: "engine",
        targetParticipantId: maya,
        state: "executed",
        resolvedAt: Date.now() - 8_000,
        reason: "invite",
        utterance: "Maya, want to share? Fine to pass!",
        ladderLevel: 2,
      });
    });
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "No. I'm good.", Date.now() - 5000, Date.now() - 4500),
    );
    // Leo just said "I'm good" too — but nobody invited him: NOT a decline
    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, leo, "I'm good", Date.now() - 3000, Date.now() - 2500),
    );
    vi.advanceTimersByTime(11_000); // clear the commit-time dedupe window

    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    let audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].reason).toContain("passed recently");

    vi.advanceTimersByTime(11_000);
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(leo, 2),
      decision: { ...namedInvite(leo), utterance: "Leo, want to share yours? Fine to pass!" },
      prompt: "p",
      llmResponse: "r",
    });
    audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].type).toBe("draw_out"); // Leo is fair game — no invite preceded his words
    expect(audit[0].state).toBe("pending");
  });

  test("a selection answered 'Pass this time' also blocks re-targeting", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(api.interactions.recordAction, {
      sessionId,
      participantId: maya,
      type: "selection",
      details: { prompt: "Want to share?", answer: "Pass this time" },
    });
    await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    });
    const audit = await t.query(api.intents.audit, { sessionId });
    expect(audit[0].type).toBe("do_nothing");
    expect(audit[0].reason).toContain("passed recently");
  });

  test("stale sweep cancels a suggest-only card whose target spoke", async () => {
    const t = newTest();
    const { sessionId, maya } = await seedActiveSession(t);
    await t.mutation(api.therapist.setDial, { sessionId, dial: "suggest-only" });
    const intentId = (await t.mutation(internal.engine.commitDecision, {
      sessionId,
      wake: drawOutWake(maya, 2),
      decision: namedInvite(maya),
      prompt: "p",
      llmResponse: "r",
    })) as Id<"agentIntents">;

    await t.mutation(
      api.worker.recordUtterance,
      speak(sessionId, maya, "actually I want to share!", Date.now(), Date.now() + 1500),
    );
    await t.mutation(internal.engine.tick, { sessionId, n: 1 });

    const feed = await t.query(api.intents.feed, { sessionId });
    const card = feed.find((i) => i._id === intentId) as Doc<"agentIntents">;
    expect(card.state).toBe("canceled");
    expect(card.cancellationReason).toBe("stale");
  });
});
