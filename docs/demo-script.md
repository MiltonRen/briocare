# BrioCare — the demo script

A rehearsed ~6-minute arc that shows every load-bearing behavior once: the
handoff, the round, a real invite → answer → affirm, a pass respected, the
delivery gate yielding to a talking kid, a distress line becoming a quiet
flag, and the review page. Numbers at the bottom are measured, not aspirational.

## Setup (once)

```bash
cd src && npm install && npm run dev     # convex + worker + web
```

Keep `npm run dev` running in its own terminal. Everything below assumes it.

## Option A — one command, sims do the talking

```bash
cd src && npm run demo
```

- Creates a session as **Dr. River**, joins four sim kids — **Dax** the
  dominator, **Sana** the silent one, **Theo** the tangent-chaser, **Effie**
  the eager helper — and prints the link.
- Open the link, type your name, join. The moment you're in, the script
  starts the session and hands the room to Brio.
- The sims are **audible**: each one sits in the LiveKit room and speaks its
  lines through TTS, so Brio hears them through its real STT ears. You are a
  kid in the group — share something when invited, or say "I want to pass"
  and watch it stick.
- `npm run demo -- --headless` runs the same personas without media (their
  lines land directly in the transcript) — useful on a machine with no
  LiveKit access.

## Option B — you drive the therapist panel (the full showcase)

```bash
# 1. create the session in your browser (Dr. River is prefilled — one click)
# 2. then attach the sims to it:
cd src && npm run demo -- <paste the session link>
```

You keep the therapist role: the panel, the dial, the veto, the equity
ledger, and the green **"Hand to Brio"** button on Brio's tile. Press Start,
press the handoff, then narrate:

1. **The handoff** (~0:00) — Brio's tile turns green, the character appears,
   and it introduces the exercise. Point at the intent card that just
   appeared in the feed: every word Brio says exists as an auditable row
   first.
2. **The round** (~0:20) — Brio invites an unheard kid *by name, with an
   out*. The sims answer per persona; Sana answers shyly only when invited.
3. **The affirm** (~0:40) — a first share gets one warm, non-evaluative
   sentence. Show the card's `reason`.
4. **The pass** — say "I want to pass" yourself when invited. Brio accepts in
   one line and never comes back to you; show the equity ledger while you
   stay untargeted (3-minute cool-off, enforced at commit, not prompted).
5. **The delivery gate** — talk *while* a Brio card executes: the line waits
   for 2.5s of silence; keep talking past 12s and it's given back —
   `canceled (yielded)` in the feed, and the kids never heard it.
6. **The dial** — flip to *3s delay*, veto a card mid-countdown with ✕; flip
   to *suggest-only* and approve one with ✓. Then back to autonomous.
7. **The flag** (if demoing with a colleague, have them say "sometimes I feel
   like nobody loves me") — a red banner appears on YOUR panel only; nothing
   changes in the kids' room. Acknowledge it.
8. **Supervise from outside** — leave the room; the kids see only each other
   and Brio; you keep the panel + the timestamped transcript log.
9. **End → review** (~5:30) — the same link becomes the review page: full
   timeline, every decision with its audit, drafted per-child notes
   (observable-behavior only) ready to edit.

## What to say while it runs (the one-liners)

- "The engine picks moments from data; the worker owns the microphone and
  never talks over a child."
- "Autonomous doesn't mean unsupervised — every move is a row the therapist
  can veto, and mute is the brake."
- "A pass is final — not because the prompt says so, but because the write
  is vetoed."

## Measured latencies (dev deployment, LiveKit Cloud US West)

| hop | measured |
|---|---|
| actor decision (gpt-5-mini, minimal effort) | 0.9–2.3 s |
| kid stops talking → Brio's voice (autonomous, quiet room) | ≈ 5–9 s |
| handoff press → intro audible | ≈ 4–6 s |
| post-session notes (2 kids) | ≈ 1.4–3.4 s |

The 2.5 s of that budget is deliberate (the thought-gap debounce — a
facilitator's beat, not lag).

## If something misbehaves

- **No transcripts / no Brio voice** — the worker probably isn't running;
  check the `worker` lines in `npm run dev`. Restart it: the missed-track
  sweep re-attaches to everyone already in the room.
- **Brio never speaks** — did you press the green handoff on its tile? The
  engine proposes nothing before an executed introduce (by design).
- **Sims silent in Option B** — the script waits for YOUR handoff; it prints
  what it's waiting for.
- **Echo/cross-talk weirdness** — use headphones; one open mic can pick up
  another voice and mis-attribute it (documented v0 limitation).
