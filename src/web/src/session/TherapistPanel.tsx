// The therapist's control surface: flags first (loud), then Brio's controls,
// the intent card feed (approve/veto), and the live equity ledger.
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc, Id } from "@briocare/backend/convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { fmtDur, useNow } from "../lib/app";

const VETO_WINDOW_MS = 3000; // mirror of backend constants — display only

const DIALS = [
  { value: "autonomous", label: "Autonomous", hint: "Brio speaks instantly. Mute is your brake." },
  { value: "auto-with-delay", label: "3s delay", hint: "Each move waits 3s — tap ✕ to veto it." },
  { value: "suggest-only", label: "Suggest-only", hint: "Nothing is voiced without your ✓." },
] as const;

type Props = { session: Doc<"sessions">; roster: Doc<"participants">[] };

export default function TherapistPanel({ session, roster }: Props) {
  const now = useNow(5000);
  const end = useMutation(api.sessions.end);
  const kids = roster.filter((p) => p.role === "child");
  const names = useMemo(() => new Map(roster.map((p) => [p._id as string, p.name])), [roster]);

  return (
    <div className="panel">
      <div className="spread">
        <div>
          <h3>
            {session.startedAt ? fmtDur(now - session.startedAt) : ""} ·{" "}
            {kids.length} kids
          </h3>
          <div className="muted">{session.exerciseDescription}</div>
        </div>
        <button
          className="danger"
          onClick={() => {
            if (confirm("End the session for everyone? The link becomes the review page.")) {
              void end({ sessionId: session._id });
            }
          }}
        >
          End
        </button>
      </div>
      <Flags session={session} names={names} />
      <BrioControls session={session} kids={kids} />
      <IntentFeed session={session} names={names} now={now} />
      <Equity session={session} kids={kids} now={now} />
    </div>
  );
}

function Flags({ session, names }: { session: Doc<"sessions">; names: Map<string, string> }) {
  const flags = useQuery(api.therapist.flags, { sessionId: session._id });
  const ack = useMutation(api.therapist.ackFlag);
  const open = (flags ?? []).filter((f) => f.status === "open");
  if (open.length === 0) return null;
  return (
    <section aria-live="assertive">
      {open.map((f) => (
        <div className="flag" key={f._id}>
          <div className="spread">
            <strong>⚠ Check on {names.get(f.participantId) ?? "?"}</strong>
            <button className="small" onClick={() => ack({ flagId: f._id })}>
              Acknowledge
            </button>
          </div>
          <q>{f.text}</q>
          <div className="muted">Only you can see this. Nothing changed in the kids' room.</div>
        </div>
      ))}
    </section>
  );
}

function BrioControls({ session, kids }: { session: Doc<"sessions">; kids: Doc<"participants">[] }) {
  const setMuted = useMutation(api.therapist.setAgentMuted);
  const setDial = useMutation(api.therapist.setDial);
  const introduced = useQuery(api.intents.hasIntroduced, { sessionId: session._id });
  const requestMove = useMutation(api.therapist.requestMove);
  const [cueText, setCueText] = useState("");
  const [target, setTarget] = useState<Id<"participants"> | "">("");
  const [error, setError] = useState<string | null>(null);
  const eligible = kids.filter((k) => k.expectedParticipationWeight > 0);

  const move = (m: "cue" | "introduce" | "draw_out" | "affirm" | "link" | "cut_off" | "block") => {
    setError(null);
    requestMove({
      sessionId: session._id,
      move: m,
      targetParticipantId: target === "" ? undefined : target,
      cueText: cueText || undefined,
    })
      .then(() => setCueText(""))
      .catch((e) => setError(e instanceof Error ? e.message.split("Uncaught Error: ").pop()! : String(e)));
  };

  return (
    <section>
      <div className="spread">
        <h3>🪑 Brio</h3>
        <button
          className={`small ${session.agentMuted ? "danger" : ""}`}
          onClick={() => setMuted({ sessionId: session._id, muted: !session.agentMuted })}
        >
          {session.agentMuted ? "Muted — tap to unmute" : "Mute Brio"}
        </button>
      </div>
      {introduced === false && (
        <p className="muted">
          Silent until you hand over the room — the green button sits on Brio's video tile.
        </p>
      )}
      <div className="row" role="radiogroup" aria-label="autonomy dial">
        {DIALS.map((d) => (
          <button
            key={d.value}
            className={`small ${session.agentAutonomyDial === d.value ? "primary" : ""}`}
            title={d.hint}
            onClick={() => setDial({ sessionId: session._id, dial: d.value })}
          >
            {d.label}
          </button>
        ))}
      </div>
      <label>Cue Brio (optional instruction)</label>
      <div className="row">
        <input
          value={cueText}
          onChange={(e) => setCueText(e.target.value)}
          placeholder='e.g. "Introduce the next part of the exercise"'
        />
        <button onClick={() => move("cue")}>Cue</button>
      </div>
      <label>Named moves — target: </label>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <select value={target} onChange={(e) => setTarget(e.target.value as Id<"participants">)} style={{ width: "auto" }}>
          <option value="">pick a kid…</option>
          {eligible.map((k) => (
            <option key={k._id} value={k._id}>
              {k.name}
            </option>
          ))}
        </select>
        <button className="small" disabled={!target} onClick={() => move("draw_out")}>Draw out</button>
        <button className="small" disabled={!target} onClick={() => move("affirm")}>Affirm</button>
        <button className="small" disabled={!target} onClick={() => move("link")}>Link</button>
        <button className="small" disabled={!target} onClick={() => move("cut_off")}>Cut off</button>
        <button className="small" onClick={() => move("block")}>Block topic</button>
      </div>
      {error && <p style={{ color: "var(--z-red)", fontSize: 13 }}>{error}</p>}
    </section>
  );
}

function IntentFeed({
  session,
  names,
  now,
}: {
  session: Doc<"sessions">;
  names: Map<string, string>;
  now: number;
}) {
  const feed = useQuery(api.intents.feed, { sessionId: session._id });
  const approve = useMutation(api.intents.approve);
  const cancel = useMutation(api.intents.cancel);
  const rows = (feed ?? []).slice(0, 12);

  return (
    <section>
      <h3>Brio's moves</h3>
      {rows.length === 0 && <p className="muted">Nothing yet — cards appear here before Brio speaks.</p>}
      {rows.map((i) => {
        const delayed = session.agentAutonomyDial === "auto-with-delay" && i.source === "engine";
        const remaining = i._creationTime + VETO_WINDOW_MS - now;
        return (
          <div key={i._id} className={`intent ${i.state}`}>
            <div className="spread">
              <span>
                <span className={`chip ${i.state}`}>{i.state}</span>{" "}
                <strong>{i.type.replace(/_/g, " ")}</strong>
                {i.targetParticipantId && <> → {names.get(i.targetParticipantId)}</>}
                {i.type === "draw_out" && i.ladderLevel !== undefined && (
                  <span className="muted"> · L{i.ladderLevel}</span>
                )}
              </span>
              {i.state === "pending" && (
                <span className="row">
                  <button className="small primary" onClick={() => approve({ intentId: i._id })}>
                    ✓ Now
                  </button>
                  <button className="small danger" onClick={() => cancel({ intentId: i._id })}>
                    ✕ Veto
                  </button>
                </span>
              )}
              {i.state === "canceled" && <span className="muted">{i.cancellationReason}</span>}
            </div>
            {i.utterance && <div className="utterance">“{i.utterance}”</div>}
            <div className="why">{i.reason}</div>
            {i.state === "pending" && delayed && remaining > -1000 && (
              <div className="countdown">
                <div style={{ animationDuration: `${VETO_WINDOW_MS}ms` }} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Equity({
  session,
  kids,
  now,
}: {
  session: Doc<"sessions">;
  kids: Doc<"participants">[];
  now: number;
}) {
  const stats = useQuery(api.sessions.stats, { sessionId: session._id, now });
  const setWeight = useMutation(api.therapist.setWeight);
  const setPMuted = useMutation(api.therapist.setParticipantMuted);
  return (
    <section className="equity">
      <h3>Participation</h3>
      {(stats ?? []).map((s) => {
        const kid = kids.find((k) => k._id === s.participantId);
        return (
          <div key={s.participantId} className="kidrow">
            <div className="spread">
              <strong>{s.name}</strong>
              <span className="muted">
                {Math.round(s.airtimeMs / 1000)}s · {s.promptsUsed}/3 prompts ·{" "}
                {Math.round(s.silentForMs / 60000)}m quiet
              </span>
            </div>
            <div className="bar" title={`share ${Math.round(s.share * 100)}% vs expected ${Math.round(s.expectedShare * 100)}%`}>
              <div className="fill" style={{ width: `${Math.min(100, s.share * 100)}%` }} />
              <div className="expect" style={{ left: `${Math.min(100, s.expectedShare * 100)}%` }} />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.5}
                value={s.weight}
                title={`participation weight ${s.weight}${s.weight === 0 ? " (never targeted)" : ""}`}
                onChange={(e) => setWeight({ participantId: s.participantId, weight: Number(e.target.value) })}
              />
              <button
                className="small"
                onClick={() => setPMuted({ participantId: s.participantId, muted: !kid?.muted })}
              >
                {kid?.muted ? "Unmute" : "Mute"}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
