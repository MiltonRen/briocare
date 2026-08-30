// Phase-0 Spike A: prove the media-worker shape end to end.
// - joins any new room as "Brio" (auto-dispatch: no agentName set)
// - publishes a TTS greeting on its own audio track
// - runs one LiveKit Inference STT stream PER remote participant track and
//   logs speaker-attributed final transcripts
// Throwaway; the real worker replaces this file.
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
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteTrack,
  type RemoteParticipant,
} from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env.local", import.meta.url).pathname, override: true });

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log(`[spike] Brio joined room "${ctx.room.name}"`);

    // --- voice out: publish a TTS track and greet ---
    const ttsEngine = new openai.TTS({ model: "gpt-4o-mini-tts", voice: "nova" });
    const source = new AudioSource(ttsEngine.sampleRate, 1);
    const track = LocalAudioTrack.createAudioTrack("brio-voice", source);
    const publishOpts = new TrackPublishOptions({
      source: TrackSource.SOURCE_MICROPHONE,
    });
    await ctx.room.localParticipant?.publishTrack(track, publishOpts);
    const speak = async (text: string) => {
      const t0 = Date.now();
      const chunked = ttsEngine.synthesize(text);
      let frames = 0;
      for await (const audio of chunked) {
        await source.captureFrame(audio.frame);
        frames++;
      }
      console.log(`[spike][tts] spoke ${frames} frames in ${Date.now() - t0}ms`);
    };
    void speak(
      "Hi everyone! I'm Brio. I'm here to help us take turns today. I can't wait to hear from you.",
    );

    // --- voice in: one STT stream per remote participant audio track ---
    const sttEngine = new inference.STT({
      model: "deepgram/nova-3",
      language: "en",
      // Inference gateway caps sample rate (48k rejected). inference.STT does
      // not resample either — so we ask AudioStream for 16 kHz mono directly
      // and let its native resampler do the work.
    });

    const transcribeTrack = async (
      remoteTrack: RemoteTrack,
      participant: RemoteParticipant,
    ) => {
      console.log(`[spike][stt] transcribing ${participant.identity}`);
      const sttStream = sttEngine.stream();
      const frames = new AudioStream(remoteTrack, { sampleRate: 16000, numChannels: 1 });
      const pump = async () => {
        for await (const frame of frames) sttStream.pushFrame(frame);
        sttStream.endInput();
      };
      void pump();
      for await (const ev of sttStream) {
        if (ev.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
          const alt = ev.alternatives?.[0];
          if (alt?.text)
            console.log(`🗣️  [${participant.identity}] "${alt.text}"`);
        }
      }
    };

    ctx.room.on(
      RoomEvent.TrackSubscribed,
      (remoteTrack, _pub, participant) => {
        if (remoteTrack.kind === TrackKind.KIND_AUDIO) {
          void transcribeTrack(remoteTrack, participant);
        }
      },
    );

    // --- speaking detection: the airtime signal ---
    ctx.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      console.log(
        `[spike][speaking] ${speakers.map((s) => s.identity).join(", ") || "(silence)"}`,
      );
    });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
