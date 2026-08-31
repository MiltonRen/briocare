# BrioCare

**Brio** is a voice AI co-facilitator for clinician-supervised pediatric group teletherapy
(kids 8–12). It joins the video call as a visible, audible participant; watches airtime and
participation equity; and makes small facilitation moves — draw-outs, affirmations,
re-engagements — each one proposed by deterministic triggers, worded by a single LLM call,
re-checked by hard constraints, and gated by the therapist's veto. Distress signals raise
private flags for the clinician, never a spoken response.

Built for the 48-hour build challenge @ AI Fund.

- **PRD**: `docs/prd.html` · **Technical design**: `docs/tdd.html` (architecture:
  *"Reflexes, judgment, and a veto"*)
- **Challenge context**: `context/build_challenge_brief.txt` (rules & evaluation criteria) ·
  `context/info_meeting_transcript.txt` (AI Fund's domain knowledge and prototyping directions)
- **Code**: `src/backend` (the brain — Convex: triggers, actor, constraints, gate, notes) ·
  `src/worker` (the media pipe — LiveKit agent: per-child STT, airtime, Brio's TTS voice) ·
  `src/web` (React: kid view, therapist panel, review page)

## Run it

Prereqs: Node ≥ 22, npm. Accounts: [Convex](https://convex.dev) (free),
[LiveKit Cloud](https://cloud.livekit.io) (free Build tier), an OpenAI API key.

```bash
cd src
npm install
```

One-time wiring (two keys total — OpenAI and LiveKit):

1. **Backend** — `cd src/backend && npx convex dev --once --configure=new` (creates a free
   dev deployment; anonymous local mode works too). Then set its env:

   ```bash
   npx convex env set OPENAI_API_KEY sk-...
   npx convex env set LIVEKIT_URL wss://<project>.livekit.cloud
   npx convex env set LIVEKIT_API_KEY <key>
   npx convex env set LIVEKIT_API_SECRET <secret>
   ```

2. **Worker** — copy `src/worker/.env.example` → `.env.local`, fill the same LiveKit trio +
   OpenAI key + your Convex deployment URL.
3. **Web** — copy `src/web/.env.example` → `.env.local`, set `VITE_CONVEX_URL` to the same
   Convex URL.

Then, from `src/`:

```bash
npm run dev
```

That starts all three (Convex functions, the Brio media worker, and the web app at
<http://localhost:5173>). Open the web app → create a session (you're the therapist) →
open the invite link in other tabs/devices as kids → **Start session**. Brio is dispatched
into the room automatically and stays silent until you press the green **"Hand to Brio"**
button on its video tile — from then on it leads the exercise while you supervise (from
inside the room or from outside, panel-only).

### No other people handy? Run the sim demo

```bash
npm run demo
```

Four sim kids (a dominator, a silent one, a tangent-chaser, an eager helper) join a fresh
session and **speak through TTS in the LiveKit room**, so Brio hears them with its real
STT. Open the printed link, join with your name, and the session starts itself. To keep
the therapist panel instead, create the session in your browser first and attach the sims
with `npm run demo -- <session link>`. `--headless` skips media (sim lines land straight
in the transcript). See `docs/demo-script.md` for the rehearsed 6-minute arc.

## Test it

```bash
cd src
npm test
```

58 keyless tests (no API keys, no network): pure trigger/participation/constraint logic —
including the observed level-0-name-ban failure mode — plus full guarded-intent lifecycle
races (approve vs veto vs auto-execute vs mute vs dial flips), the watchlist tripwire,
rate limits, and the trigger → actor → audited-commit loop via the no-key fallback path.

## What to try in a session

- Talk as one kid and stay silent as another: watch the equity bars drift, then Brio's
  draw-out ladder — an unnamed group cue first (L0), a private on-screen choice (L1, with
  "pass" always offered), a gentle named invite (L2) — with per-child cooldowns and a
  3-prompt ceiling.
- Flip the dial to **suggest-only**: cards wait for your ✓ / ✕. In autonomous, you get a
  short veto window instead.
- **Mute Brio** mid-sentence — playback stops within a frame; pending cards cancel.
- Say a distress phrase as a kid: a private flag appears on the panel only (tripwire is
  zero-latency; a 10s LLM sweep catches subtler phrasing). Nothing is ever voiced about it.
- End the session: the same URL becomes a permanent review page — merged timeline, every
  decision auditable (`do_nothing` rows behind a debug toggle, each with its exact prompt
  and raw model response), transcript, and draft per-kid notes (counts + the child's own
  words only) you can edit.

## Known limitations (v0)

- No auth: a session URL is an unguessable id and the only credential; anyone with the
  link can view its review page.
- Therapist force-mute is honored by the kid's client, not enforced by the media server.
- STT is unvalidated on real children's speech (adult/synthetic audio only so far); name
  pronunciation by TTS is untested for unusual names.
- One exercise format (therapist free-text); captions are final transcripts, not partials.
- The engine tick chain lives in scheduled Convex functions; if a tick transaction ever
  failed the loop would stop for that session (not observed in testing).
- Data is dev-tier and unencrypted at the application layer — synthetic/demo data only.

## Deployment

- convex just works, there's a claude plugin for it if you need help
- i use render.com for the frontend, but you can deploy it anywhere
- for lk agent see below

### LiveKit Agent Deployment
lk project list
cd src
grep -E '^(OPENAI_API_KEY|CONVEX_URL)=' worker/.env.local > /tmp/brio-agent-secrets.env
lk agent create --secrets-file /tmp/brio-agent-secrets.env .
rm /tmp/brio-agent-secrets.env
lk agent logs

for following deployments, run ```lk agent deploy .```
