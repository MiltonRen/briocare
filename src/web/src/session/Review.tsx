// After the end, the same URL becomes a permanent review page: notes to edit,
// flags, a merged timeline (do_nothing rows behind a debug toggle — every
// decision is auditable), and the frozen transcript.
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc } from "@briocare/backend/convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { fmtClock, fmtDur } from "../lib/app";

type Props = {
  session: Doc<"sessions">;
  roster: Doc<"participants">[];
  me: Doc<"participants"> | null;
};

export default function Review({ session, me }: Props) {
  const data = useQuery(api.sessions.review, { sessionId: session._id });
  const saveNote = useMutation(api.therapist.setPostSessionNote);
  const regenerate = useAction(api.notes.regenerate);
  const [showAudit, setShowAudit] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  const names = useMemo(
    () => new Map((data?.participants ?? []).map((p) => [p._id as string, p.name])),
    [data],
  );
  if (!data) return <div className="waiting">Loading review…</div>;

  const kids = data.participants.filter((p) => p.role === "child");
  const started = data.session.startedAt ?? data.session._creationTime;
  const duration =
    data.session.endedAt && data.session.startedAt
      ? fmtDur(data.session.endedAt - data.session.startedAt)
      : "—";

  type Evt = { at: number; kind: string; label: string; who?: string; cls?: string };
  const events: Evt[] = [
    ...data.utterances
      .filter((u) => u.sttOk && u.text)
      .map((u) => ({ at: u.startAt, kind: "said", label: u.text, who: names.get(u.participantId) })),
    ...data.actions.map((a) => ({
      at: a._creationTime,
      kind: a.type,
      label: a.type === "reaction" ? (a.details?.emoji ?? "") : `answered “${a.details?.answer}”`,
      who: names.get(a.participantId),
    })),
    ...data.intents
      .filter((i) => showAudit || i.type !== "do_nothing")
      .map((i) => ({
        at: i._creationTime,
        kind: `brio ${i.type.replace(/_/g, " ")} (${i.state}${i.cancellationReason ? `: ${i.cancellationReason}` : ""})`,
        label: i.utterance ?? i.reason,
        who: i.targetParticipantId ? `→ ${names.get(i.targetParticipantId)}` : undefined,
        cls: "brio",
      })),
    ...data.flags.map((f) => ({
      at: f._creationTime,
      kind: "⚠ distress flag",
      label: f.text,
      who: names.get(f.participantId),
      cls: "flagged",
    })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="shell">
      <div className="brand">
        BrioCare <small>session review</small>
      </div>
      <div className="card">
        <h2>{duration} session · {kids.length} kids</h2>
        <p className="muted">Exercise: <em>{data.session.exerciseDescription}</em></p>
        {data.flags.length > 0 && (
          <p style={{ color: "var(--z-red)" }}>
            ⚠ {data.flags.length} distress flag{data.flags.length > 1 ? "s" : ""} raised — see the
            timeline below.
          </p>
        )}
      </div>

      <div className="card">
        <div className="spread">
          <h3>Notes per kid <span className="muted">(drafts — counts and their own words only)</span></h3>
          <button
            className="small"
            disabled={regenBusy}
            onClick={() => {
              setRegenBusy(true);
              void regenerate({ sessionId: session._id }).finally(() => setRegenBusy(false));
            }}
          >
            {regenBusy ? "Drafting…" : "Regenerate drafts"}
          </button>
        </div>
        {kids.map((kid) => (
          <div key={kid._id} style={{ marginTop: 12 }}>
            <label>{kid.name}{kid.preSessionNote ? ` — pre-session: “${kid.preSessionNote}”` : ""}</label>
            <textarea
              key={`${kid._id}:${kid.postSessionNote ?? ""}`}
              defaultValue={kid.postSessionNote ?? ""}
              placeholder="No draft yet."
              onBlur={(e) => saveNote({ participantId: kid._id, note: e.target.value })}
            />
          </div>
        ))}
        <p className="muted">Edits save when you click away. You own these notes.</p>
      </div>

      <div className="card">
        <div className="spread">
          <h3>Timeline</h3>
          <label style={{ margin: 0 }}>
            <input
              type="checkbox"
              style={{ width: "auto", marginRight: 6 }}
              checked={showAudit}
              onChange={(e) => setShowAudit(e.target.checked)}
            />
            show do_nothing decisions (full audit)
          </label>
        </div>
        <div className="timeline" style={{ marginTop: 10 }}>
          {events.map((e, idx) => (
            <div key={idx} className={`evt ${e.cls ?? ""}`}>
              <span className="t">{fmtClock(e.at, started)}</span>
              <strong>{e.who ?? "Brio"}</strong> <span className="muted">{e.kind}</span>{" "}
              {e.label && <span>— {e.label}</span>}
            </div>
          ))}
        </div>
      </div>

      {data.session.transcript && (
        <div className="card">
          <details>
            <summary><strong>Full transcript</strong></summary>
            <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{data.session.transcript}</pre>
          </details>
        </div>
      )}
      {!me && <p className="muted">Viewing as a guest with the link.</p>}
    </div>
  );
}
