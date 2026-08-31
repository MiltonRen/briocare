// One URL, four faces: join screen → lobby → live room → review. The session
// id in the URL is the only credential; localStorage remembers who you are.
import { useMutation, useQuery } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc } from "@briocare/backend/convex/_generated/dataModel";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { getIdentity, getPersistedIdentity, storeIdentity } from "../lib/app";
import Lobby from "../session/Lobby";
import ActiveRoom from "../session/ActiveRoom";
import Review from "../session/Review";

export default function SessionPage() {
  const { sessionId = "" } = useParams();
  const session = useQuery(api.sessions.resolve, { sessionId });
  const roster = useQuery(
    api.sessions.roster,
    session ? { sessionId: session._id } : "skip",
  );

  if (session === undefined) return <Center msg="Loading…" />;
  if (session === null) return <Center msg="This link doesn't point to a session." />;
  if (roster === undefined) return <Center msg="Loading…" />;

  const storedId = getIdentity(session._id);
  const me = roster.find((p) => p._id === storedId) ?? null;
  const resumable = roster.find((p) => p._id === getPersistedIdentity(session._id)) ?? null;

  if (session.status === "ended") return <Review session={session} roster={roster} me={me} />;
  if (!me) return <JoinScreen session={session} resumable={resumable} />;
  if (session.status === "lobby") return <Lobby session={session} roster={roster} me={me} />;
  return <ActiveRoom session={session} roster={roster} me={me} />;
}

function JoinScreen({
  session,
  resumable,
}: {
  session: Doc<"sessions">;
  resumable: Doc<"participants"> | null;
}) {
  const join = useMutation(api.sessions.join);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resume = resumable && (
    <div className="card">
      <div className="spread">
        <span>
          This browser created this session as <strong>{resumable.name}</strong>.
        </span>
        <button
          onClick={() => {
            storeIdentity(session._id, resumable._id);
            window.location.reload();
          }}
        >
          Continue as {resumable.name}
        </button>
      </div>
    </div>
  );

  if (session.status === "active") {
    return (
      <div className="shell">
        <div className="brand">BrioCare</div>
        {resume}
        <p className="muted">This session has already started — new joins are locked.</p>
      </div>
    );
  }
  const onJoin = async () => {
    try {
      const { participantId } = await join({ sessionId: session._id, name });
      storeIdentity(session._id, participantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="shell">
      <div className="brand">BrioCare</div>
      {resume}
      <div className="card">
        <h2>Hi! What's your name?</h2>
        <p className="muted">Your therapist and the group will see it.</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onJoin()}
          placeholder="Type your first name"
          autoFocus
        />
        {error && <p style={{ color: "var(--z-red)" }}>{error}</p>}
        <div style={{ marginTop: 16 }}>
          <button className="primary" disabled={!name.trim()} onClick={onJoin}>
            Join the group
          </button>
        </div>
      </div>
    </div>
  );
}

function Center({ msg }: { msg: string }) {
  return (
    <div className="shell" style={{ textAlign: "center", paddingTop: "20vh" }}>
      <div className="brand">BrioCare</div>
      <p className="muted">{msg}</p>
    </div>
  );
}
