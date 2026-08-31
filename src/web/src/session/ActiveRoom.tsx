// The live room. LiveKit renders media; everything else renders Convex
// subscriptions. Brio appears as a real participant tile (audio-only) — and
// until the therapist presses the big green button ON that tile, the engine
// proposes nothing. The therapist can also supervise from OUTSIDE the room
// (panel + captions only, no media join) — the breakout-room deployment model.
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useIsSpeaking,
  useTracks,
  useTrackRefContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc } from "@briocare/backend/convex/_generated/dataModel";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtClock, useNow } from "../lib/app";
import brioCalm from "../assets/brio-calm.png";
import brioTalk from "../assets/brio-talk.png";
import KidView from "./KidView";
import TherapistPanel from "./TherapistPanel";

type Props = {
  session: Doc<"sessions">;
  roster: Doc<"participants">[];
  me: Doc<"participants">;
};

const HANDOFF_CUE =
  "You have just been handed the room. Introduce yourself briefly, then open today's exercise and invite the first share — no names, passing is always okay.";

// A tile caption lingers this long after the line ENDED, then fades away.
const CAPTION_TTL_MS = 12_000;

export default function ActiveRoom({ session, roster, me }: Props) {
  const isTherapist = me.role === "therapist";
  const superviseKey = `briocare:supervise:${session._id}`;
  const [supervise, setSupervise] = useState(
    () => isTherapist && sessionStorage.getItem(superviseKey) === "1",
  );
  const setSuperviseMode = (on: boolean) => {
    sessionStorage.setItem(superviseKey, on ? "1" : "0");
    setSupervise(on);
  };

  const mint = useAction(api.livekit.mintRoomToken);
  const [conn, setConn] = useState<{ serverUrl: string; token: string } | null | "error">(null);
  useEffect(() => {
    if (supervise) return;
    let gone = false;
    mint({ sessionId: session._id, participantId: me._id })
      .then((r) => !gone && setConn(r ?? "error"))
      .catch(() => !gone && setConn("error"));
    return () => {
      gone = true;
    };
  }, [session._id, me._id, mint, supervise]);

  const body = isTherapist ? (
    <TherapistPanel session={session} roster={roster} />
  ) : (
    <KidView session={session} roster={roster} me={me} />
  );

  if (isTherapist && supervise) {
    return (
      <div className="session">
        <div className="stage">
          <div className="captions spread">
            <span>👀 Supervising from outside the room — the kids see only each other and Brio.</span>
            <button className="small" onClick={() => setSuperviseMode(false)}>
              Join the room
            </button>
          </div>
          <TranscriptLog session={session} roster={roster} />
          <HandoffHint session={session} />
        </div>
        {body}
      </div>
    );
  }

  if (conn === "error") {
    // Video may be unavailable (no LiveKit env, no camera) — the session
    // still works: captions, cards, and controls all run on Convex.
    return (
      <div className={`session ${isTherapist ? "" : "kid"}`}>
        <div className="stage">
          <div className="captions">Video unavailable — running without media.</div>
          <TranscriptLog session={session} roster={roster} />
        </div>
        {body}
      </div>
    );
  }
  if (!conn) return <div className="waiting">Connecting…</div>;

  return (
    <LiveKitRoom
      serverUrl={conn.serverUrl}
      token={conn.token}
      connect
      audio={!me.muted}
      video
      style={{ height: "100vh" }}
    >
      <RoomAudioRenderer />
      <div className={`session ${isTherapist ? "" : "kid"}`}>
        <div className="stage">
          {isTherapist && (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="small" onClick={() => setSuperviseMode(true)}>
                👀 Supervise from outside
              </button>
            </div>
          )}
          <Grid session={session} roster={roster} isTherapist={isTherapist} />
          <ControlBar
            variation="minimal"
            controls={{ microphone: true, camera: true, screenShare: false, chat: false, leave: false }}
          />
        </div>
        {body}
      </div>
    </LiveKitRoom>
  );
}

function Grid({
  session,
  roster,
  isTherapist,
}: {
  session: Doc<"sessions">;
  roster: Doc<"participants">[];
  isTherapist: boolean;
}) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  const introduced = useQuery(api.intents.hasIntroduced, { sessionId: session._id });
  const requestMove = useMutation(api.therapist.requestMove);
  const setPMuted = useMutation(api.therapist.setParticipantMuted);
  const [handing, setHanding] = useState(false);
  const byId = useMemo(() => new Map(roster.map((p) => [p._id as string, p])), [roster]);

  // Everyone's latest transcribed line, shown under their own tile until it
  // goes stale (CAPTION_TTL after the line ended).
  const now = useNow(2000);
  const rows = useQuery(api.sessions.captions, { sessionId: session._id });
  const lastLine = useMemo(() => {
    const m = new Map<string, { text: string; at: number }>();
    for (const u of rows ?? [])
      if (u.sttOk && u.text) m.set(u.participantId as string, { text: u.text, at: u.endAt });
    return m;
  }, [rows]);

  // Brio's caption is its latest ACTUALLY-voiced line (yielded/vetoed never show).
  const feed = useQuery(api.intents.feed, { sessionId: session._id });
  const brioLine = useMemo(() => {
    const voiced = (feed ?? []).filter((i) => i.voicedAt && i.utterance);
    voiced.sort((a, b) => (b.voicedAt ?? 0) - (a.voicedAt ?? 0));
    const top = voiced[0];
    return top ? { text: top.utterance!, at: top.voicedAt! } : null;
  }, [feed]);

  const showHandoff = isTherapist && introduced === false && !handing;
  const onHandoff = () => {
    setHanding(true);
    requestMove({ sessionId: session._id, move: "introduce", cueText: HANDOFF_CUE }).catch(
      () => setHanding(false),
    );
  };

  return (
    <GridLayout tracks={tracks}>
      <Tile
        byId={byId}
        isTherapist={isTherapist}
        brioLive={introduced === true}
        lastLine={lastLine}
        brioLine={brioLine}
        now={now}
        showHandoff={showHandoff}
        onHandoff={onHandoff}
        onToggleMute={(p) => void setPMuted({ participantId: p._id, muted: !p.muted })}
      />
    </GridLayout>
  );
}

/** GridLayout renders this once per track; the track arrives via context. The
 * one participant NOT in the Convex roster is the media worker — Brio, whose
 * tile turns green and shows the Brio character once the room is handed over
 * (the excited pose while it's actually talking). */
function Tile({
  byId,
  isTherapist,
  brioLive,
  lastLine,
  brioLine,
  now,
  showHandoff,
  onHandoff,
  onToggleMute,
}: {
  byId: Map<string, Doc<"participants">>;
  isTherapist: boolean;
  brioLive: boolean;
  lastLine: Map<string, { text: string; at: number }>;
  brioLine: { text: string; at: number } | null;
  now: number;
  showHandoff: boolean;
  onHandoff: () => void;
  onToggleMute: (p: Doc<"participants">) => void;
}) {
  const trackRef = useTrackRefContext();
  const speaking = useIsSpeaking(trackRef.participant);
  const p = byId.get(trackRef.participant.identity);
  const isBrio = !p;
  const line = isBrio ? brioLine : (lastLine.get(trackRef.participant.identity) ?? null);
  const caption = line && now - line.at < CAPTION_TTL_MS ? line.text : null;
  return (
    <div className={`tilewrap ${isBrio && brioLive ? "brio-live" : ""}`}>
      <ParticipantTile trackRef={trackRef} />
      {isBrio && brioLive && (
        <img
          className={`brio-face ${speaking ? "talking" : ""}`}
          src={speaking ? brioTalk : brioCalm}
          alt="Brio"
        />
      )}
      {isBrio && showHandoff && (
        <button className="handoff" onClick={onHandoff}>
          👋 Hand to Brio
        </button>
      )}
      {isTherapist && p?.role === "child" && (
        <button
          className={`tilemute ${p.muted ? "muted" : ""}`}
          title={p.muted ? "Give their mic back" : "Mute this kid's mic"}
          onClick={() => onToggleMute(p)}
        >
          {p.muted ? "🔇 Unmute" : "Mute"}
        </button>
      )}
      {caption && <div className={`tilecap ${isBrio ? "brio" : ""}`}>{caption}</div>}
    </div>
  );
}

function HandoffHint({ session }: { session: Doc<"sessions"> }) {
  const introduced = useQuery(api.intents.hasIntroduced, { sessionId: session._id });
  if (introduced !== false) return null;
  return (
    <div className="captions">
      🪑 Brio is in the room, silent, waiting for your handoff — join the room to press the green
      button on its tile.
    </div>
  );
}

/** The outside-the-room view: the whole conversation as a log — what the kids
 * said, interleaved (by time) with what Brio ACTUALLY voiced. */
export function TranscriptLog({
  session,
  roster,
}: {
  session: Doc<"sessions">;
  roster: Doc<"participants">[];
}) {
  const rows = useQuery(api.sessions.captions, { sessionId: session._id });
  const feed = useQuery(api.intents.feed, { sessionId: session._id });
  const names = useMemo(() => new Map(roster.map((p) => [p._id as string, p.name])), [roster]);
  const base = session.startedAt ?? session._creationTime;

  const lines = useMemo(() => {
    const spoken = (rows ?? [])
      .filter((u) => u.sttOk && u.text)
      .map((u) => ({
        key: u._id as string,
        at: u.startAt,
        name: names.get(u.participantId as string) ?? "?",
        text: u.text,
        brio: false,
      }));
    const voiced = (feed ?? [])
      .filter((i) => i.voicedAt && i.utterance)
      .map((i) => ({
        key: i._id as string,
        at: i.voicedAt!,
        name: "Brio",
        text: i.utterance!,
        brio: true,
      }));
    return [...spoken, ...voiced].sort((a, b) => a.at - b.at);
  }, [rows, feed, names]);

  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="captions translog" ref={boxRef}>
      {lines.length === 0 && <span className="muted">The conversation will appear here…</span>}
      {lines.map((l) => (
        <div className={`line ${l.brio ? "brio" : ""}`} key={l.key}>
          <span className="t">{fmtClock(l.at, base)}</span>
          <b>{l.brio ? "🪑 Brio" : l.name}</b> {l.text}
        </div>
      ))}
    </div>
  );
}
