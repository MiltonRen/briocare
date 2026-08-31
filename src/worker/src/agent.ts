// BrioCare media worker — the dumb pipe between LiveKit and the Convex brain.
// It joins a room (room name == sessionId) when Convex dispatches it, then:
//   hears : per-participant Inference STT  → worker.recordUtterance
//   clocks: LiveKit speaking events        → worker.bumpAirtime (sole airtime writer)
//   speaks: watches agentIntents via one Convex subscription — pre-synthesizes
//           TTS while a card is pending, plays the moment it turns executed.
// It makes NO decisions. Every rule lives in src/backend.
import {
  type JobContext,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  stt,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import {
  type AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { ConvexClient } from "convex/browser";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Id } from "@briocare/backend/convex/_generated/dataModel";
import { MODELS } from "@briocare/backend/convex/lib/constants";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// override: the dev shell exports a stale OPENAI_API_KEY — .env.local wins.
dotenv.config({ path: new URL("../.env.local", import.meta.url).pathname, override: true });

const AIRTIME_FLUSH_MS = 3_000;
const MIN_BURST_FOR_STT_MS = 1_500; // shorter bursts: airtime only, no sttOk:false row
const STT_GRACE_MS = 2_500; // how long after a burst we wait for a transcript
// The delivery gate: the worker is the only component that can see the live
// floor, so IT decides whether a decided line actually gets air.
const FLOOR_GAP_MS = 2_500; // silence Brio wants before it starts speaking
const YIELD_BUDGET_MS = 12_000; // floor stays busy this long → give the line back, unspoken
const BARGE_IN_MS = 800; // a human talking this long WHILE Brio speaks → Brio stops

type WorkerView = {
  status: "lobby" | "active" | "ended";
  agentMuted: boolean;
  participants: { _id: Id<"participants">; name: string; role: "therapist" | "child" }[];
  pending: { _id: string; type: string; utterance: string | null; ladderLevel: number | null }[];
  executed: { _id: string; type: string; utterance: string | null; ladderLevel: number | null }[];
} | null;

/** Level-1 draw-outs are on-screen only; everything else with text is voiced. */
const isVoiced = (i: { type: string; utterance: string | null; ladderLevel: number | null }) =>
  i.utterance !== null && i.utterance !== "" && !(i.type === "draw_out" && i.ladderLevel === 1) &&
  i.type !== "suggest_to_therapist";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const sessionId = ctx.room.name as string;
    console.log(`[brio] joined room ${sessionId}`);
    try {
      await ctx.room.localParticipant?.updateName("Brio");
      await ctx.room.localParticipant?.updateMetadata(JSON.stringify({ kind: "brio" }));
    } catch (e) {
      console.warn("[brio] could not set name/metadata:", e);
    }

    const convex = new ConvexClient(process.env.CONVEX_URL!);
    let view: WorkerView = null;
    try {
      view = await convex.query(api.worker.view, { sessionId: sessionId as Id<"sessions"> });
    } catch (e) {
      console.error(`[brio] room ${sessionId} is not a session — leaving.`, e);
      await convex.close();
      return;
    }

    // ---- voice out ------------------------------------------------------
    // Voice choice lives in backend constants; "marin" postdates the plugin's
    // TTSVoices union (the API accepts it — verified), hence the type cast.
    type TTSVoice = NonNullable<NonNullable<ConstructorParameters<typeof openai.TTS>[0]>["voice"]>;
    const ttsEngine = new openai.TTS({ model: MODELS.tts, voice: MODELS.ttsVoice as TTSVoice });
    const source = new AudioSource(ttsEngine.sampleRate, 1);
    const track = LocalAudioTrack.createAudioTrack("brio-voice", source);
    await ctx.room.localParticipant?.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );

    const synthCache = new Map<string, Promise<AudioFrame[]>>();
    const synthesize = (text: string): Promise<AudioFrame[]> =>
      (async () => {
        const frames: AudioFrame[] = [];
        for await (const audio of ttsEngine.synthesize(text)) frames.push(audio.frame);
        return frames;
      })();

    const playQueue: { id: string; utterance: string }[] = [];
    let playing = false;
    let muted = view?.agentMuted ?? false;
    let stopped = false;
    let airtimeTimer: ReturnType<typeof setInterval> | undefined;
    // live human speaking state — fed by ActiveSpeakersChanged below, read by
    // the politeness wait in the pump
    const speaking = new Map<string, { since: number; lastFlush: number }>();
    let lastSpeechStopAt = 0;
    const pump = async () => {
      if (playing) return;
      playing = true;
      while (playQueue.length > 0 && !stopped) {
        const item = playQueue.shift()!;
        if (muted) continue; // dropped, never queued behind a mute
        const frames = await (synthCache.get(item.id) ?? synthesize(item.utterance));
        synthCache.delete(item.id);
        // Hold the line ready and take a real gap: nobody speaking, and a
        // beat of silence since the last human stopped. If the room stays
        // busy past the budget, the moment has passed — give the line back
        // (canceled/yielded, fully audited) instead of barging in late.
        const waitStart = Date.now();
        let yielded = false;
        while (!muted && !stopped) {
          if (speaking.size === 0 && Date.now() - lastSpeechStopAt >= FLOOR_GAP_MS) break;
          if (Date.now() - waitStart > YIELD_BUDGET_MS) {
            yielded = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        if (yielded) {
          console.log(`[brio] yielding intent ${item.id} — the floor never opened`);
          void convex
            .mutation(api.intents.yieldIntent, { intentId: item.id as Id<"agentIntents"> })
            .catch((e) => console.error("[brio] yield failed:", e));
          continue;
        }
        if (muted || stopped) continue;
        console.log(`[brio] speaking intent ${item.id}: "${item.utterance.slice(0, 60)}…"`);
        let humanSince: number | null = null;
        for (const frame of frames) {
          if (muted || stopped) break; // captureFrame paces in real time → mid-sentence mute works
          // Barge-in: Brio ALWAYS yields to children. A human talking through
          // BARGE_IN_MS while Brio speaks cuts the line off mid-sentence.
          if (speaking.size > 0) {
            humanSince ??= Date.now();
            if (Date.now() - humanSince > BARGE_IN_MS) {
              console.log(`[brio] barge-in — stopping mid-line for a human`);
              break;
            }
          } else {
            humanSince = null;
          }
          await source.captureFrame(frame);
        }
        void convex
          .mutation(api.intents.markVoiced, {
            intentId: item.id as Id<"agentIntents">,
            at: Date.now(),
          })
          .catch((e) => console.error("[brio] markVoiced failed:", e));
      }
      playing = false;
    };

    // ---- the one subscription that drives playback ----------------------
    const roster = new Map<string, { name: string; role: string }>();
    const seenExecuted = new Set((view?.executed ?? []).map((i) => i._id)); // no history replay
    const applyView = (v: WorkerView) => {
      if (!v) return;
      muted = v.agentMuted;
      for (const p of v.participants) roster.set(p._id, { name: p.name, role: p.role });
      for (const i of v.pending) {
        if (isVoiced(i) && !synthCache.has(i._id)) {
          synthCache.set(i._id, synthesize(i.utterance!)); // pre-warm during the veto window
        }
      }
      for (const i of v.executed) {
        if (seenExecuted.has(i._id)) continue;
        seenExecuted.add(i._id);
        if (isVoiced(i)) {
          playQueue.push({ id: i._id, utterance: i.utterance! });
          void pump();
        }
      }
      if (v.status === "ended" && !stopped) {
        stopped = true;
        console.log("[brio] session ended — leaving room");
        void (async () => {
          clearInterval(airtimeTimer);
          await convex.close();
          await ctx.room.disconnect();
        })();
      }
    };
    applyView(view);
    convex.onUpdate(
      api.worker.view,
      { sessionId: sessionId as Id<"sessions"> },
      (v) => applyView(v as WorkerView),
      (e) => console.error("[brio] subscription error:", e),
    );

    // ---- airtime: speaking events are the ledger ------------------------
    // speakingSince/lastFlush per identity; a 3s heartbeat plus a final flush
    // on burst end. recordUtterance never writes airtime (single-writer rule).
    const lastBurst = new Map<string, { start: number; end: number }>();
    const lastFinalAt = new Map<string, number>();
    const bump = (participantId: string, deltaMs: number) => {
      if (deltaMs <= 0 || stopped) return;
      void convex
        .mutation(api.worker.bumpAirtime, {
          sessionId: sessionId as Id<"sessions">,
          participantId: participantId as Id<"participants">,
          deltaMs: Math.round(deltaMs),
          at: Date.now(),
        })
        .catch((e) => console.error("[brio] bumpAirtime failed:", e));
    };
    airtimeTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, s] of speaking) {
        bump(id, now - s.lastFlush);
        s.lastFlush = now;
      }
    }, AIRTIME_FLUSH_MS);

    ctx.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const now = Date.now();
      const active = new Set(speakers.map((s) => s.identity));
      for (const id of roster.keys()) {
        const s = speaking.get(id);
        if (active.has(id) && !s) {
          speaking.set(id, { since: now, lastFlush: now });
        } else if (!active.has(id) && s) {
          speaking.delete(id);
          lastSpeechStopAt = now;
          bump(id, now - s.lastFlush);
          const burst = { start: s.since, end: now };
          lastBurst.set(id, burst);
          // sttOk:false fallback — a real burst with no transcript still lands,
          // so the airtime ledger and the utterance log can't drift silently.
          if (burst.end - burst.start >= MIN_BURST_FOR_STT_MS) {
            setTimeout(() => {
              if (stopped) return;
              if ((lastFinalAt.get(id) ?? 0) < burst.start) {
                void convex
                  .mutation(api.worker.recordUtterance, {
                    sessionId: sessionId as Id<"sessions">,
                    participantId: id as Id<"participants">,
                    startAt: burst.start,
                    endAt: burst.end,
                    text: "",
                    sttOk: false,
                  })
                  .catch((e) => console.error("[brio] sttOk:false record failed:", e));
              }
            }, STT_GRACE_MS);
          }
        }
      }
    });

    // ---- voice in: one Inference STT stream per human track --------------
    // A/B'd against flux/AssemblyAI/Cartesia/Speechmatics (see agent-notes):
    // nova-3 fits this pipeline best. Every model garbled the invented name
    // ("Rio"/"Briel") until boosted — keyterm fixes it, verified.
    const sttEngine = new inference.STT({
      model: MODELS.stt,
      language: "en",
      modelOptions: { keyterm: ["Brio"] },
    });
    const transcribing = new Set<string>(); // track sids — the late sweep and the event can both find a track
    const transcribeTrack = async (remoteTrack: RemoteTrack, participant: RemoteParticipant) => {
      const participantId = participant.identity;
      const sid = remoteTrack.sid ?? `${participantId}:${remoteTrack.name}`;
      if (transcribing.has(sid)) return;
      transcribing.add(sid);
      // No roster gate here — the roster may still be loading when an early
      // track appears. Membership is checked per final, where it matters.
      console.log(`[brio] transcribing ${roster.get(participantId)?.name ?? participantId}`);
      const sttStream = sttEngine.stream();
      // Inference STT does not resample (and rejects 48k) — ask rtc-node for 16k mono.
      const frames = new AudioStream(remoteTrack, { sampleRate: 16000, numChannels: 1 });
      void (async () => {
        for await (const frame of frames) sttStream.pushFrame(frame);
        sttStream.endInput();
      })();
      for await (const ev of sttStream) {
        if (stopped) break;
        if (ev.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
        const text = ev.alternatives?.[0]?.text?.trim();
        if (!text) continue;
        if (!roster.has(participantId)) {
          console.log(`[brio] dropping final from unknown identity ${participantId}`);
          continue;
        }
        const now = Date.now();
        lastFinalAt.set(participantId, now);
        // Honest timing: prefer the live speaking burst, then the last one.
        const live = speaking.get(participantId);
        const prev = lastBurst.get(participantId);
        const [startAt, endAt] = live
          ? [live.since, now]
          : prev && now - prev.end < 4000
            ? [prev.start, prev.end]
            : [now - 2500, now];
        console.log(`[brio] 🗣 ${roster.get(participantId)?.name}: "${text}"`);
        void convex
          .mutation(api.worker.recordUtterance, {
            sessionId: sessionId as Id<"sessions">,
            participantId: participantId as Id<"participants">,
            startAt,
            endAt,
            text,
            sttOk: true,
          })
          .catch((e) => console.error("[brio] recordUtterance failed:", e));
      }
    };
    ctx.room.on(RoomEvent.TrackSubscribed, (remoteTrack, _pub, participant) => {
      if (remoteTrack.kind === TrackKind.KIND_AUDIO) void transcribeTrack(remoteTrack, participant);
    });
    // THE MISSED-TRACK SWEEP: with real humans, their tracks are usually in
    // the room BEFORE this handler exists (they subscribe during connect,
    // while we were still awaiting setup). Sweep everything already there —
    // the sid set makes the two paths safely overlap.
    for (const participant of ctx.room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        const track = pub.track;
        if (track && track.kind === TrackKind.KIND_AUDIO) {
          void transcribeTrack(track as RemoteTrack, participant);
        }
      }
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: process.env.LIVEKIT_AGENT_NAME ?? "brio", // explicit dispatch only
  }),
);
