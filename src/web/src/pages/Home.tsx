import { useMutation } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { storeIdentity } from "../lib/app";

export default function Home() {
  const create = useMutation(api.sessions.create);
  const navigate = useNavigate();
  const [name, setName] = useState("Dr. River"); // prefilled — one click to a session
  const [exercise, setExercise] = useState(
    "Share one favorite thing from this week — a moment, a thing, or a person.",
  );
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const { sessionId, participantId } = await create({
      therapistName: name.trim(),
      exerciseDescription: exercise.trim(),
    });
    storeIdentity(sessionId, participantId, true); // creator persists across tabs
    navigate(`/s/${sessionId}`);
  };

  return (
    <div className="shell">
      <div className="brand">
        BrioCare <small>a co-facilitator with reflexes, judgment, and a veto</small>
      </div>
      <div className="card bloom">
        <h2>Start a group session</h2>
        <p className="muted">
          You'll be the therapist. You get a link to share with the kids; Brio joins when you
          press start.
        </p>
        <label>Your name (as the kids see it)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. River" />
        <label>Today's exercise, in your own words (Brio reads this verbatim)</label>
        <textarea value={exercise} onChange={(e) => setExercise(e.target.value)} />
        <div style={{ marginTop: 16 }}>
          <button className="primary" disabled={busy || !name.trim()} onClick={onCreate}>
            Create session
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 14 }}>
        Joining as a kid? Open the link your therapist sent you.
      </p>
      <section className="docs">
        <div className="docs-head">
          <span className="eyebrow">The documents</span>
          <span className="hair" />
        </div>
        <div className="docgrid">
          <a
            className="doccard"
            href="https://claude.ai/code/artifact/281e36ab-f9f8-4b3d-bf62-5e332090279b"
            target="_blank"
            rel="noreferrer"
          >
            <span className="doctag">PRD</span>
            <h3>The second chair, staffed by software</h3>
            <p>
              Why clinical practice says a group takes two therapists — and the rules the
              co-facilitator works under.
            </p>
            <span className="docgo">
              Read the PRD <i>&rarr;</i>
            </span>
          </a>
          <a
            className="doccard"
            href="https://claude.ai/code/artifact/d38e028b-f753-449c-9723-84cd74ca3d9e"
            target="_blank"
            rel="noreferrer"
          >
            <span className="doctag">TDD</span>
            <h3>Reflexes, judgment, and a veto</h3>
            <p>
              How it works: deterministic reflexes wake a supervised model, and every word passes
              the therapist&rsquo;s controls.
            </p>
            <span className="docgo">
              Read the TDD <i>&rarr;</i>
            </span>
          </a>
        </div>
      </section>
    </div>
  );
}
