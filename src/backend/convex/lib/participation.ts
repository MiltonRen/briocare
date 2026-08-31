// Pure participation math. Derived values (share, deficit, promptsUsed,
// ladder level) are computed here at read time — never stored. Inputs are
// plain rows so this module unit-tests without a database.
import type { Doc, Id } from "../_generated/dataModel";
import { DOMINANCE_WINDOW_MS } from "./constants";

export type ChildStats = {
  participantId: Id<"participants">;
  name: string;
  weight: number;
  airtimeMs: number; // whole session
  windowAirtimeMs: number; // rolling dominance window
  share: number; // fraction of all-children airtime, 0..1
  windowShare: number;
  expectedShare: number; // weight / Σ weights, 0..1 (0 for weight-0 kids)
  deficit: number; // relative shortfall vs expected, 0..1 (0 = at/above)
  lastActiveAt: number | null; // utterance, action, or airtime — whichever is latest
  silentForMs: number; // since lastActiveAt, or since session start
  totalUtteranceCount: number; // whole session, capped by caller's read bound
  lastUtteranceAt: number | null;
  promptsUsed: number; // executed engine draw_outs targeting this child
  ladderLevel: 0 | 1 | 2; // NEXT draw-out level for this child
};

export function deriveChildStats(args: {
  session: Doc<"sessions">;
  participants: Doc<"participants">[];
  /** utterances within at least the dominance window, any order */
  recentUtterances: Doc<"utterances">[];
  /** all agentIntents for the session (bounded read is fine) */
  intents: Doc<"agentIntents">[];
  /** per-child whole-session utterance counts (a capped count like take(2).length is fine) */
  utteranceCounts: Record<string, number>;
  now: number;
}): ChildStats[] {
  const { session, participants, recentUtterances, intents, utteranceCounts, now } = args;
  const children = participants.filter((p) => p.role === "child");
  const totalWeight = children.reduce((s, c) => s + c.expectedParticipationWeight, 0);
  const totalAirtime = children.reduce((s, c) => s + c.airtimeMs, 0);
  const sessionStart = session.startedAt ?? now;

  return children.map((c) => {
    const mine = recentUtterances.filter((u) => u.participantId === c._id);
    const windowStart = now - DOMINANCE_WINDOW_MS;
    const windowAirtimeMs = mine
      .filter((u) => u.endAt > windowStart)
      .reduce((s, u) => s + (Math.min(u.endAt, now) - Math.max(u.startAt, windowStart)), 0);
    const totalWindowAirtime = recentUtterances
      .filter((u) => u.endAt > windowStart && children.some((k) => k._id === u.participantId))
      .reduce((s, u) => s + (Math.min(u.endAt, now) - Math.max(u.startAt, windowStart)), 0);

    const share = totalAirtime > 0 ? c.airtimeMs / totalAirtime : 0;
    const windowShare = totalWindowAirtime > 0 ? windowAirtimeMs / totalWindowAirtime : 0;
    const expectedShare = totalWeight > 0 ? c.expectedParticipationWeight / totalWeight : 0;
    const deficit =
      expectedShare > 0 && totalAirtime > 0
        ? Math.max(0, (expectedShare - share) / expectedShare)
        : expectedShare > 0
          ? 1 // no airtime at all yet — fully short of expectation
          : 0;

    const lastUtteranceAt = mine.reduce<number | null>(
      (m, u) => (m === null || u.endAt > m ? u.endAt : m),
      null,
    );
    const lastActiveAt = c.lastActiveAt ?? null;
    const silentForMs = now - (lastActiveAt ?? sessionStart);

    const targeted = intents.filter(
      (i) => i.targetParticipantId === c._id && i.source === "engine" && i.state === "executed",
    );
    const promptsUsed = targeted.filter((i) => i.type === "draw_out").length;
    // Ladder escalates only while the child stays inactive: count executed
    // draw-outs at them since they last did anything.
    const sinceActive = targeted.filter(
      (i) => i.type === "draw_out" && (lastActiveAt === null || i._creationTime > lastActiveAt),
    ).length;
    const ladderLevel = Math.min(2, sinceActive) as 0 | 1 | 2;

    return {
      participantId: c._id,
      name: c.name,
      weight: c.expectedParticipationWeight,
      airtimeMs: c.airtimeMs,
      windowAirtimeMs,
      share,
      windowShare,
      expectedShare,
      deficit,
      lastActiveAt,
      silentForMs,
      totalUtteranceCount: utteranceCounts[c._id] ?? 0,
      lastUtteranceAt,
      promptsUsed,
      ladderLevel,
    };
  });
}
