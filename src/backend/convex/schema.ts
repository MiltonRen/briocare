import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// BrioCare data model — six tables. See docs/tdd.html §07 for the ERD.
//
// Conventions (they replace fields):
// - Every table carries sessionId; a session's URL is its unguessable id.
// - A participant's Convex _id doubles as their LiveKit identity.
// - Presence lives in LiveKit only; the database never stores "online".
// - _creationTime stamps every insert; explicit timestamps exist only where
//   capture time differs from write time (utterances) or marks a transition.
// - Derived values (share, deficit, promptsUsed, ladder level) are computed
//   at read time — from participants counters and agentIntents history.

// Working set of actor decisions. The per-wake legal menu is narrower and is
// built in code (hard constraints re-check it); this union documents the
// universe. Safe to extend while the dev deployment holds no real data.
const agentIntentType = v.union(
  v.literal("do_nothing"), // logged for audit; never displayed
  v.literal("draw_out"), // ladder level lives in `reason`/prompt context
  v.literal("re_engage"), // pacing observation or group selection
  v.literal("affirm"), // non-evaluative acknowledgement of a first share
  v.literal("suggest_to_therapist"), // panel-only, never voiced
  v.literal("raise_flag"), // evaluator decision; mirrored into `flags`
  v.literal("respond_to_cue"), // open cue: Brio's best contribution
  v.literal("introduce"), // therapist-cued "say hi" at session start
  v.literal("block"), // named move
  v.literal("cut_off"), // named move
  v.literal("link"), // named move
);

export default defineSchema({
  // Config + live state, folded (status: lobby → active → ended).
  sessions: defineTable({
    status: v.union(
      v.literal("lobby"),
      v.literal("active"),
      v.literal("ended"),
    ),
    exerciseDescription: v.string(), // therapist's own words; fed to the actor verbatim
    agentAutonomyDial: v.union(
      v.literal("suggest-only"),
      v.literal("autonomous"), // default: veto window, then auto-execute
    ),
    agentMuted: v.boolean(),
    transcript: v.optional(v.string()), // mechanical consolidation, written once at end
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  }),

  // People, counters, and notes, folded. One row per person per session.
  participants: defineTable({
    sessionId: v.id("sessions"),
    name: v.string(),
    role: v.union(v.literal("therapist"), v.literal("child")),
    expectedParticipationWeight: v.number(), // live-adjustable; 0 = never targeted
    muted: v.boolean(), // mic state — self-serve like any video call; therapist can also mute anyone; Brio may only suggest
    airtimeMs: v.number(), // materialized; reconstructible from utterances
    actionCount: v.number(),
    lastActiveAt: v.optional(v.number()),
    preSessionNote: v.optional(v.string()), // "Leo had a rough week"
    postSessionNote: v.optional(v.string()), // draft until the therapist edits/signs
  }).index("by_sessionId", ["sessionId"]),

  // Append-only. One row per completed speech burst: timing from LiveKit
  // speaking detection, text from per-track STT (best-effort — a burst with
  // failed STT still lands, with sttOk: false, so airtime never lies).
  utterances: defineTable({
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    startAt: v.number(),
    endAt: v.number(),
    text: v.string(),
    sttOk: v.boolean(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_participantId", ["sessionId", "participantId"]),

  // Append-only. Non-speech participation: a reaction (always-available
  // emoji/thumbs) or a selection (answer to a Brio-pushed choice, where
  // answering "pass" counts as participation too).
  actions: defineTable({
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    type: v.union(v.literal("reaction"), v.literal("selection")),
    details: v.optional(
      v.object({
        emoji: v.optional(v.string()), // reaction
        prompt: v.optional(v.string()), // selection: what was asked
        answer: v.optional(v.string()), // selection: chosen option, incl. "pass"
      }),
    ),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_participantId", ["sessionId", "participantId"]),

  // Every actor decision — do_nothing included. Voiced rows are born with
  // their final utterance text; prompt + llmResponse make each row auditable.
  // Lifecycle: pending → executed | canceled. The executed/canceled
  // transitions are guarded mutations (succeed only while pending), so an
  // approve racing a cancel is decided atomically by the database.
  agentIntents: defineTable({
    sessionId: v.id("sessions"),
    type: agentIntentType,
    source: v.union(v.literal("engine"), v.literal("therapist")),
    targetParticipantId: v.optional(v.id("participants")),
    state: v.union(
      v.literal("pending"),
      v.literal("executed"),
      v.literal("canceled"),
    ),
    reason: v.string(), // shown on the intent card ("quietest 14 min")
    utterance: v.optional(v.string()), // absent for do_nothing / suggest-only actions
    resolvedAt: v.optional(v.number()),
    cancellationReason: v.optional(
      v.union(v.literal("therapist"), v.literal("muted"), v.literal("stale")),
    ),
    prompt: v.optional(v.string()), // exact prompt sent to the model
    llmResponse: v.optional(v.string()), // raw structured output received
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_state", ["sessionId", "state"])
    .index("by_sessionId_and_targetParticipantId", ["sessionId", "targetParticipantId"]),

  // Distress workflow. Raised by the zero-latency watchlist tripwire or the
  // 10 s evaluator sweep; deduped by utteranceId. Nothing changes in any
  // child's room — the flag is a private, therapist-only alert with an ack.
  flags: defineTable({
    sessionId: v.id("sessions"),
    kind: v.literal("distress"),
    participantId: v.id("participants"),
    text: v.string(), // the exact quoted line
    utteranceId: v.id("utterances"),
    status: v.union(v.literal("open"), v.literal("acked")),
    ackedAt: v.optional(v.number()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_status", ["sessionId", "status"]),
});
