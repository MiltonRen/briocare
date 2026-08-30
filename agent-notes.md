# agent-notes.md — BrioCare implementation plan & context

Working memory for the agent across compressed conversations. Keep updated as steps complete (check boxes, add discoveries). Human = Milton (milton.x.ren@gmail.com).

## Project snapshot

- **BrioCare**: 48-hour AI Fund build challenge (Engineer-in-Residence). Prototype = **Brio**, a voice AI co-facilitator for clinician-supervised pediatric group teletherapy (telehealth, kids 8–12).
- Deliverables: PRD ✅, TDD ✅, working prototype + exact run command + exact test command, then a 45-min AI interview where Milton must walk the core loop, read code aloud, make a live change, and explain what the model receives/emits/gets wrong. **Code must be interview-narratable.**
- Two technical spikes we're claiming: (1) the trigger→actor→constraints→gate architecture with full decision audit; (2) sim-persona eval harness with equity metrics + safety invariants.
- Submission reply format: PRD / TDD / Prototype / Source code / Run command or live URL / Test command / Access notes / Known limitations.

## Key artifacts & files

- PRD v0.8: `docs/prd.html` → artifact https://claude.ai/code/artifact/281e36ab-f9f8-4b3d-bf62-5e332090279b
- TDD v0.6 ("Reflexes, judgment, and a veto"): `docs/tdd.html` → artifact https://claude.ai/code/artifact/d38e028b-f753-449c-9723-84cd74ca3d9e
- Field research: `research/pediatric-group-therapy.html`
- **Doc convention**: each doc = hidden artifact body (`docs/.prd.artifact-body.html`) + standalone (`docs/prd.html` = body wrapped in doctype/head; regenerate with the small python wrapper script used throughout). Republish via Artifact tool with SAME file path → same URL. Bump version in mast-meta + footer each edit; label `prd-vX.Y`.
- `human_notes.md` is Milton's — **never edit it** (reading ok).
- Milton's preferences: aggressive simplification, concise answers, discuss-before-change on design, keep repo root minimal (hence `src/`), docs must stay truthful to the build.

## Architecture (locked, v0)

**"Reflexes, judgment, and a veto"** — two runtimes:

1. **Media worker** (`src/worker/`, LiveKit agents-js, a dumb pipe): joins room as participant "Brio"; per-track STT via **LiveKit Inference**; speaking events → airtime; publishes Brio's TTS voice on its own audio track (Brio appears as a real participant tile with speaking indicators); watches `agentIntents` — pre-synthesizes TTS on `pending`, plays on `executed`. No decisions.
2. **The brain** (`src/backend/` Convex): deterministic **triggers** (rules + 10s sweep + therapist taps) wake a single-call LLM **actor** with full context + recommendation + **menu of legal actions**; actor returns structured `{action, target?, utterance?, reason}` or `do_nothing` (utterance written in the SAME call); **hard constraints** re-check output; **therapist gate** (veto window / tap) before anything is voiced.

Core rules:
- Autonomy dial: **autonomous = default** (~4s veto window, auto-execute on lapse; TTS pre-synthesized so playback is instant); suggest-only = one tap away (nothing voiced without tap).
- Cue / named moves (draw_out, block, cut_off, link): therapist-initiated, `do_nothing` OFF the menu, tap = approval, no window. Session greeting = a cue (therapist speaks first, then cues Brio's intro). No special start process.
- Distress: **two detectors** → same `flags` table, deduped by utteranceId: inline watchlist tripwire (zero latency, no LLM) + evaluator sweep every **10s** (menu: raise_flag | do_nothing). Flags bypass the gate (born executed). Never voiced, ever. Private panel alert + ack.
- **Every actor decision logged** in `agentIntents` incl. `do_nothing` (no card/display; audit only) with `prompt` + `llmResponse`.
- Intent lifecycle: `pending → executed | canceled(therapist|muted|stale)`. Transitions are **guarded Convex mutations** (succeed only while pending) — approve/cancel races decided atomically by the DB. Triggers self-cancel stale cards. Mute drops pending (not queued).
- No talking stick (roadmap). Free-flow discussion; mic mute is self-serve + therapist can force-mute; **Brio never touches mics** (may suggest).
- Participation model: `airtimeMs` (from LiveKit speaking detection — works without STT) + `actionCount` (reactions/selections; **pass = a selection answer, counts**). Equity: share of airtime vs `expectedParticipationWeight` (live-adjustable; **0 = never targeted**). Derived at read, never stored: share, deficit, promptsUsed (count fired intents per target), ladder level (from intent history).
- Draw-out ladder: L0 unnamed group cue (voiced) → L1 selection pushed to child's screen → L2 named invite always carrying a pass. Escalate only if prior level drew no action.
- Trigger defaults (all config; clinical calibration is week-1 roadmap): deficit >40% below weighted expectation · silent >3min · per-child cooldown 4min · prompt ceiling 3/session · idle 30s → re-engage · dominance >2× weighted share over rolling 5min → panel suggestion only.
- LLM: **no post-generation eval pass** (latency); zero-cost string sanity checks only; prototype **waits** for completions (no fallback race; failed call = no card, trigger re-fires). Therapist preview is the judge.
- Notes: ONE end-of-session LLM call writes ALL children's notes (counts first, quotes only child's own words, no clinical inference) → `postSessionNote` drafts. Session transcript = mechanical concat → `sessions.transcript`.
- Conventions: `participants._id` **is** the LiveKit identity · presence from LiveKit only (never stored) · `_creationTime` for inserts · sessions URL = unguessable id = the only auth in v0.
- UI flow (no login): create session (→ you're therapist, get link; form = exerciseDescription + defaults) → others open link, enter name → join as child → lobby (therapist sets preSessionNotes + weights) → start locks joins → active → end → **the same URL becomes a permanent review page** (timeline of utterances/actions/intents incl. do_nothing debug toggle, flags, notes editor).
- Terminology: **reaction** (always-available emoji/thumbs) & **selection** (Brio-pushed choice; answer may be "pass"). Not tap/chip.

## Stack & infra (locked)

- Web: React + Vite + TS + `@livekit/components-react` → **Render Static Site** (free).
- Brain: Convex (plain actions for LLM calls — NOT @convex-dev/agent) → **Convex Cloud** free tier.
- Worker: LiveKit agents-js (Node) → **LiveKit Cloud hosted agents** ($0 standing — billed only during sessions at $0.01/min, 1,000 min/mo free; `lk agent` CLI deploy, rollback, built-in logs/traces). Fallback ladder: Render Background Worker ~$7/mo → laptop during review window. Same code everywhere. Caution: use distinct agent names (or a dev project) so a local dev worker never double-registers against the deployment.
- Media: **LiveKit Cloud** Build tier (free: 5,000 WebRTC min, 1,000 agent min, Inference credits). One project for dev+prod; room name = sessionId.
- Models: **OpenAI only** — `gpt-5-mini` (actor/evaluator/notes; verify current small-model name at build time) + OpenAI TTS (e.g. `gpt-4o-mini-tts`, verify) . STT = LiveKit Inference (pick model string at build; OpenAI STT is the fallback swap).
- Secrets: Convex env = `LIVEKIT_API_KEY/SECRET` (room JWTs minted in a Convex action — never client-side) + `OPENAI_API_KEY`. Worker env = LiveKit keys + `OPENAI_API_KEY` + `CONVEX_URL`. **Two keys total.**
- Monorepo: `src/` = npm workspace root (keeps repo root clean). `src/backend` = `@briocare/backend`; web/worker will import `@briocare/backend/convex/_generated/api`. Add `"web"`, `"worker"` to `src/package.json` workspaces when created.

## Current state (done)

- [x] Research, PRD v0.8, TDD v0.6 (incl. deployment section + design-journey appendix) — committed by Milton.
- [x] `src/` workspace + `src/backend/convex/schema.ts` — 6 tables (sessions, participants, utterances, actions, agentIntents, flags), guideline-compliant index names (`by_sessionId`, `by_sessionId_and_state`, …), validated & deployed on **anonymous local Convex** (`npx convex dev --once`, no login; state in `backend/.convex/` + `.env.local`, gitignored).
- [x] Convex AI files installed (`backend/CLAUDE.md` → read `convex/_generated/ai/guidelines.md` before writing Convex code; skills in `backend/.claude/skills/`).
- Schema notes: `agentIntentType` union is a **working set** (do_nothing, draw_out, re_engage, affirm, suggest_to_therapist, raise_flag, respond_to_cue, introduce, block, cut_off, link) — free to change while dev DB is empty. `raise_flag` rows are born `executed`.

## Implementation plan

Walk step by step with Milton; check off as we go. 🧑 = needs Milton.

### Phase 0 — accounts & spikes (do first, cheap de-risking)
- [ ] 🧑 LiveKit Cloud account + project → get `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- [ ] 🧑 OpenAI API key (his credits)
- [ ] Put keys in `src/backend/.env.local` (Convex env vars via `npx convex env set`) and a `src/worker/.env` (gitignored)
- [ ] **Spike A**: minimal agents-js worker — join a room, subscribe 2 participants' tracks, per-track Inference STT prints attributed finals, publish a TTS track audible in a browser tab. Verify multi-track pattern + current API names (agents-js ~v1.6, Inference model strings).
- [ ] **Spike B**: Convex action → OpenAI structured output (zod/JSON schema) round-trip.
- [ ] 🧑 Optional: `/plugin install convex@claude-plugins-official` in interactive terminal.

### Phase 1 — backend functions (Convex; keyless-testable core)
- [ ] Session lifecycle: `createSession`, `joinSession(name)`, `startSession` (locks joins), `endSession` (kicks notes job + transcript concat), live queries (`getSession`, `roster`, `timeline`).
- [ ] Therapist commands (all mutations, atomic): setDial, muteAgent, setWeight, setParticipantMuted, editNote/sign, `ackFlag`.
- [ ] `recordAction` (reaction/selection; bumps actionCount + lastActiveAt; per-child rate limit; excess logs but doesn't count).
- [ ] Worker-facing: `mintRoomToken` (action; LiveKit JWT), `recordUtterance` (burst row + airtime bump + inline **watchlist tripwire** → flag), `bumpAirtime` heartbeat.
- [ ] Intents: `proposeIntent` (insert pending, schedule auto-execute via `ctx.scheduler.runAfter(windowMs)` when autonomous), `approveIntent` / `cancelIntent` / `autoExecute` (all guarded on `state=="pending"`), stale-cancel logic in triggers.
- [ ] **Triggers** (pure TS module, unit-testable, lives in `convex/lib/triggers.ts`): evaluated after recordUtterance/recordAction + a self-rescheduling tick action (~2–5s); emits wake = {recommendation, reason, menu}. Menu construction = eligibility (weight>0, ceiling, cooldowns).
- [ ] **Actor** action: build context (roster+weights, ledger summary, last ~90s utterances w/ low-confidence excluded, recent Brio actions, exerciseDescription, recommendation, menu) → one OpenAI call → structured action → hard-constraint re-check → insert intent row (or do_nothing row) with prompt+llmResponse.
- [ ] **Evaluator** action on 10s schedule while active.
- [ ] Notes action (one call, all kids) on end.
- [ ] Vitest for triggers/menu/ladder (keyless). Root `npm test` wiring.

### Phase 2 — media worker (`src/worker/`)
- [ ] Add workspace; agents-js worker. Dispatch: **LiveKit dispatch** (explicit dispatch to a named agent from `startSession`, or a dispatch rule) — the natural model for hosted agents and one job per session; local dev = run worker manually with its own agent name.
- [ ] Per-participant STT streams (multi-user transcriber pattern); burst assembly: LiveKit speaking events debounced (merge gaps <1s), attach final STT text for window, `sttOk:false` if none → `recordUtterance`.
- [ ] Airtime: isSpeaking accumulation → `bumpAirtime` every ~3s while speaking + on burst end.
- [ ] Intent playback: subscribe pending → pre-synthesize OpenAI TTS; on executed → play to published track; **audio frames gated by agentMuted at publish time** (mute mid-sentence works).
- [ ] Brio participant identity "brio" w/ metadata so UI renders its tile distinctly.

### Phase 3 — web (`src/web/`)
- [ ] Vite + React + TS scaffold; Convex provider; LiveKit room via token from Convex action.
- [ ] Home: create session form (exerciseDescription). Join page: name entry.
- [ ] Kid view: tiles (incl. Brio), reaction bar, selection prompt UI (from executed `selection`-type intents targeting me), captions (from utterances live query), self-mute.
- [ ] Therapist panel: roster w/ live equity bars (share vs weight) + weight sliders + per-kid mute + preSessionNote; Brio controls (mute, dial, cue, named moves w/ target picker); **intent cards** (exact utterance text, countdown ring in autonomous, approve/cancel); flag alerts (loud, private) + ack; start/end.
- [ ] Review page (status=ended, same URL): merged timeline (utterances/actions/intents/flags by time; do_nothing behind a debug toggle), transcript, notes editor + sign, table-data debug view.
- [ ] Design: reuse the sage/green-zone system from docs (Newsreader/Public Sans/IBM Plex Mono, tokens in docs/.prd.artifact-body.html) — kid view warmer/simpler.

### Phase 4 — sims, evals, demo
- [ ] Sim personas (dominator, silent one, tangent-chaser, eager helper): scripts driving mutations directly (headless) AND joinable as room participants for live demo (stretch: TTS audio into room so they're audible).
- [ ] `npm run demo`: seeds a session with sims, prints the therapist link.
- [ ] Eval harness `npm run eval`: scenario scripts → metrics (participation Gini, silent-persona time-to-first-action <4min on / never off, ceiling respected, **unnecessary-action rate** vs annotated do_nothing scenarios) + **invariants** (suggest-only never auto-executes; nothing while muted; spoken lines trace to rows born with that text; canceled never reach audio; distress → flag + zero voiced; weight-0 → zero targeted intents; every decision has prompt+response) → writes markdown report. Scripted-actor mode = keyless; live-actor mode needs OPENAI key.
- [ ] Demo script doc: create → sims + Milton-as-kid join → cue intro → exercise → visible draw-out ladder → sim distress line → flag → end → review + notes. Latency numbers measured & noted for TDD.

### Phase 5 — deploy & submit
- [ ] 🧑 `npx convex login` in `src/backend` → link project, `npx convex deploy`; set prod env vars.
- [ ] 🧑 Render: Static Site (root `src/web`, build `npm run build`). Worker: deploy to **LiveKit Cloud agents** (`lk agent create/deploy`, secrets via `lk agent` CLI); fall back to Render Background Worker or local if the cloud build eats time.
- [ ] Root `README.md`: exact run command (target: `cd src && npm install && npm run dev` doing convex+web+worker via concurrently), exact test command, env setup, reviewer access notes (scoped keys), known limitations (no auth; sessions=unguessable URLs; adult/synthetic data only; name pronunciation; child-ASR unvalidated; single exercise).
- [ ] Final doc pass: update TDD if implementation drifted (it must match reality — reviewers compare); republish artifacts (same URLs); Milton shares artifact links or exports.
- [ ] 🧑 Submission email per format above; then the AI interview within ~30min (repo open; appendix in TDD = evolution story cheat-sheet).

## Open decisions (resolve during build, with Milton if significant)
- Exact model strings: gpt-5-mini?, TTS model, Inference STT model.
- Who transitions pending→executed (approve mutation directly vs worker-confirmed) — current lean: mutation sets executed; worker plays on seeing it.
- Live captions: v0 = finals-only via Convex; partials via LiveKit transcription topic only if cheap.
- Enforcing therapist force-mute (LiveKit server API vs client-honored flag).
- Suggest-only pending cards: no timer — stale-cancel only.

## Verify-before-trusting (post-compression cautions)
- Re-check current API shapes at build time: agents-js multi-track STT + TTS publishing, LiveKit Inference model ids, OpenAI model names, Convex scheduler patterns. Use `backend/convex/_generated/ai/guidelines.md` for all Convex code.
- Budget: everything free except Render worker $7/mo (if used); OpenAI usage on Milton's credits; LiveKit free tier limits above.
