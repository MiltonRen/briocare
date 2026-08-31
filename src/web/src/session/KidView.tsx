// The kid's screen: warm and minimal. Reactions are always available;
// selections (level-1 draw-outs) arrive as a private, dismissible card that
// always includes a pass. The therapist's force-mute is honored here.
import { useMaybeRoomContext } from "@livekit/components-react";
import { ParticipantEvent, Track, type TrackPublication } from "livekit-client";
import { useMutation, useQuery } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc } from "@briocare/backend/convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";
import { useNow } from "../lib/app";

const EMOJI = ["👍", "❤️", "😂", "🎉", "🙋"];
const SELECTION_OPTIONS = ["Yes — I'll share!", "Can I think a bit?", "Pass this time"];
const SELECTION_FRESH_MS = 3 * 60_000;

type Props = {
  session: Doc<"sessions">;
  roster: Doc<"participants">[];
  me: Doc<"participants">;
};

export default function KidView({ session, me }: Props) {
  const record = useMutation(api.interactions.recordAction);
  const selections = useQuery(api.interactions.mySelections, {
    sessionId: session._id,
    participantId: me._id,
  });
  const recent = useQuery(api.interactions.recentActions, { sessionId: session._id });
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [floaty, setFloaty] = useState<string | null>(null);
  const now = useNow(10_000);
  const room = useMaybeRoomContext();

  // ONE readable truth for mic state: participants.muted in Convex. The
  // therapist's buttons write it and this client applies it to the real mic
  // (mute AND unmute); the kid's OWN mic taps are reported back into it, so
  // the dashboard never drifts from the actual microphone. Enforcement is
  // still client-side only (v0 limitation, see README).
  const setPMuted = useMutation(api.therapist.setParticipantMuted);
  const mutedRef = useRef(me.muted);
  mutedRef.current = me.muted;
  useEffect(() => {
    if (room) void room.localParticipant.setMicrophoneEnabled(!me.muted).catch(() => {});
  }, [me.muted, room]);
  useEffect(() => {
    if (!room) return;
    const lp = room.localParticipant;
    const report = (pub: TrackPublication) => {
      if (pub.source !== Track.Source.Microphone) return;
      const enabled = lp.isMicrophoneEnabled;
      if (mutedRef.current === enabled) // Convex and the mic disagree
        void setPMuted({ participantId: me._id, muted: !enabled });
    };
    lp.on(ParticipantEvent.TrackMuted, report);
    lp.on(ParticipantEvent.TrackUnmuted, report);
    lp.on(ParticipantEvent.LocalTrackPublished, report);
    lp.on(ParticipantEvent.LocalTrackUnpublished, report);
    return () => {
      lp.off(ParticipantEvent.TrackMuted, report);
      lp.off(ParticipantEvent.TrackUnmuted, report);
      lp.off(ParticipantEvent.LocalTrackPublished, report);
      lp.off(ParticipantEvent.LocalTrackUnpublished, report);
    };
  }, [room, me._id, setPMuted]);

  const active = (selections ?? []).find(
    (s) =>
      !answered.has(s._id) &&
      (s.resolvedAt ?? s._creationTime) > now - SELECTION_FRESH_MS,
  );

  const react = (emoji: string) => {
    void record({ sessionId: session._id, participantId: me._id, type: "reaction", details: { emoji } });
    setFloaty(emoji);
    setTimeout(() => setFloaty(null), 900);
  };

  const answer = (s: Doc<"agentIntents">, choice: string) => {
    setAnswered((prev) => new Set(prev).add(s._id));
    void record({
      sessionId: session._id,
      participantId: me._id,
      type: "selection",
      details: { prompt: s.utterance ?? "", answer: choice },
    });
  };

  const lastReaction = (recent ?? []).filter((a) => a.type === "reaction").slice(-1)[0];

  return (
    <>
      <div className="reactionbar">
        {EMOJI.map((e) => (
          <button key={e} onClick={() => react(e)} aria-label={`react ${e}`}>
            {e}
          </button>
        ))}
      </div>
      {floaty && <div className="reaction-float">{floaty}</div>}
      {!floaty && lastReaction && now - lastReaction._creationTime < 4000 && (
        <div className="reaction-float">{lastReaction.details?.emoji}</div>
      )}
      {active && (
        <div className="selection-overlay">
          <div className="selection-card">
            <div style={{ fontSize: 40 }}>🪑</div>
            <h3>Brio asks…</h3>
            <p>{active.utterance}</p>
            <div className="options">
              {SELECTION_OPTIONS.map((opt) => (
                <button key={opt} onClick={() => answer(active, opt)}>
                  {opt}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Only you can see this. Passing is always okay.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
