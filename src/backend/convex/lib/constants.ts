// Tuning knobs for the engine. Every number the TDD's trigger table promises
// lives here; clinical calibration of the defaults is week-1 roadmap work.

// Dial semantics: "autonomous" executes instantly; "auto-with-delay" gives the
// therapist this veto window first; "suggest-only" voices nothing without a tap.
export const VETO_WINDOW_MS = 3_000;

export const ENGINE_TICK_MS = 5_000; // idle-detector/fallback sweep while active
export const EVALUATOR_EVERY_N_TICKS = 2; // distress sweep every 2nd tick (~10s)
export const ENGINE_MIN_GAP_MS = 3_000; // min spacing between actor wakes (do_nothing counts)

// A thought's end: same-speaker STT finals closer than this merge into one
// utterance row, wake evaluation waits this long after the last final, and the
// worker wants this much room-silence before Brio's voice starts.
export const THOUGHT_GAP_MS = 2_500;

// After Brio speaks it is waiting for an answer: no new voiced engine move
// until either a child RESPONDS (any utterance/reaction/pass — a response IS
// the floor handing back) or this much dead air passes.
export const BRIO_GRACE_MS = 12_000;

// Never come back to the SAME child faster than this in the follow-up phase.
export const FOLLOWUP_TARGET_COOLDOWN_MS = 60_000;

// A pass is FINAL for a good while: a child who passed (out loud or on
// screen) cannot be targeted by any engine move until this lapses.
export const PASS_COOLOFF_MS = 180_000;

/** Deterministic verbal-pass detector: a short reply containing "pass" — or
 * "past", which is what STT reliably makes of a mumbled "pass" ("I'm past").
 * Not a long story that happens to mention a mountain pass. False positives
 * are benign: the child is simply left alone for a few minutes. */
export function looksLikePass(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 40 && /\b(pass|past)\b/i.test(t);
}

/** Kids rarely say "pass" — they say "No, I'm good." A soft decline counts as
 * a pass ONLY when it lands shortly after the child was invited (the
 * conjunction keeps precision: "I'm good" as an answer to a feelings question
 * is not a decline). */
export function looksLikeSoftDecline(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 45) return false;
  return (
    /^(no|nah|nope)\b/i.test(t) ||
    /\b(i'?m (good|okay|ok|fine)|no thanks?|not (right )?now|maybe later)\b/i.test(t)
  );
}

/** How soon after an invite a soft decline still reads as declining IT. */
export const DECLINE_REPLY_WINDOW_MS = 30_000;


export const DEFICIT_THRESHOLD = 0.4; // >40% below weighted expected share
export const DEFICIT_WARMUP_MS = 60_000; // no deficit math until a minute of child airtime exists
export const SILENT_MS = 90_000; // no utterance/action for this long → draw-out candidate
export const CHILD_COOLDOWN_MS = 4 * 60_000; // per-child gap between targeted EQUITY moves (rounds exempt)
export const ROUND_COOLDOWN_MS = 25_000; // per-child gap between round invites
export const PROMPT_CEILING = 3; // max targeted draw-outs per child per session
export const GROUP_IDLE_MS = 15_000; // whole room quiet this long → re-engage
export const IDLE_COOLDOWN_MS = 45_000; // don't re-engage more often than this
export const DOMINANCE_FACTOR = 2; // >2× weighted share over the rolling window
export const DOMINANCE_WINDOW_MS = 5 * 60_000;
export const AFFIRM_FRESH_MS = 20_000; // a "first share" is only affirmable this long

export const STALE_INTENT_MS = 45_000; // pending cards older than this self-cancel
export const UTTERANCE_MAX_CHARS = 300; // hard cap on anything Brio may say

export const ACTION_RATE_LIMIT = { count: 6, windowMs: 10_000 }; // per child; excess logs, doesn't count

export const MODELS = {
  actor: "gpt-5-mini", // reasoning_effort "minimal" is mandatory — see agent-notes
  tts: "gpt-4o-mini-tts",
  // gpt-realtime's warm voice; the plain TTS endpoint accepts it too (verified
  // live) even though most SDK voice unions haven't caught up yet.
  ttsVoice: "marin",
  stt: "deepgram/nova-3", // LiveKit Inference model id
};

export const AGENT_NAME = "brio"; // LiveKit explicit-dispatch agent name (worker registers it)

// Zero-latency distress tripwire. Substring match, lowercase. Deliberately
// small and high-precision — the 10s LLM sweep covers phrasing this misses.
export const WATCHLIST: string[] = [
  "hurt myself",
  "kill myself",
  "want to die",
  "wanna die",
  "want to disappear",
  "hate myself",
  "hits me",
  "hit me",
  "hurts me",
  "not safe at home",
  "don't feel safe",
  "nobody loves me",
  "everyone hates me",
  "stop touching me",
];

export function watchlistHit(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of WATCHLIST) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}
