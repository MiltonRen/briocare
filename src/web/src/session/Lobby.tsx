import { useMutation } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc } from "@briocare/backend/convex/_generated/dataModel";
import { useState } from "react";

type Props = {
  session: Doc<"sessions">;
  roster: Doc<"participants">[];
  me: Doc<"participants">;
};

export default function Lobby({ session, roster, me }: Props) {
  if (me.role === "child") {
    return (
      <div className="waiting">
        <div className="big">🪑</div>
        <h2>You're in, {me.name}!</h2>
        <p className="muted">
          Waiting for {roster.find((p) => p.role === "therapist")?.name ?? "your therapist"} to
          start the group…
        </p>
      </div>
    );
  }
  return <TherapistLobby session={session} roster={roster} />;
}

function TherapistLobby({ session, roster }: Omit<Props, "me">) {
  const start = useMutation(api.sessions.start);
  const setWeight = useMutation(api.therapist.setWeight);
  const setPreNote = useMutation(api.therapist.setPreSessionNote);
  const [copied, setCopied] = useState(false);
  const kids = roster.filter((p) => p.role === "child");
  const link = window.location.href;

  return (
    <div className="shell">
      <div className="brand">BrioCare <small>lobby</small></div>
      <div className="card">
        <div className="spread">
          <h2>Waiting room</h2>
          <button
            className="primary"
            onClick={() => start({ sessionId: session._id })}
            disabled={kids.length === 0}
            title={kids.length === 0 ? "Wait for at least one kid to join" : ""}
          >
            Start session
          </button>
        </div>
        <p className="muted">
          Exercise: <em>{session.exerciseDescription}</em>
        </p>
        <label>Invite link — send it to the kids (joins lock when you start)</label>
        <div className="joinlink">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Who's here ({kids.length})</h3>
        {kids.length === 0 && <p className="muted">Nobody yet — share the link above.</p>}
        {kids.map((kid) => (
          <div key={kid._id} style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: 10, marginTop: 10 }}>
            <div className="spread">
              <strong>{kid.name}</strong>
              <span className="muted">
                participation weight {kid.expectedParticipationWeight}
                {kid.expectedParticipationWeight === 0 && " — never targeted"}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.5}
              value={kid.expectedParticipationWeight}
              onChange={(e) =>
                setWeight({ participantId: kid._id, weight: Number(e.target.value) })
              }
            />
            <input
              placeholder={`Pre-session note about ${kid.name} (only you and Brio see this)`}
              defaultValue={kid.preSessionNote ?? ""}
              onBlur={(e) => setPreNote({ participantId: kid._id, note: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
