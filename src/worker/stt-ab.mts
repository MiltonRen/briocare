// STT A/B harness: push the same PCM through LiveKit Inference STT with a
// given model, print FINAL transcripts with arrival times. Mirrors the
// worker's exact usage (inference.STT → stream → FINAL_TRANSCRIPT events).
//
//   npx tsx stt-ab.mts <model> <16k-mono-s16le.pcm> [keyterm,keyterm]
//   e.g. npx tsx stt-ab.mts deepgram/nova-3 kid.pcm Brio
//   (make a pcm: ffmpeg -i clip.mp3 -ar 16000 -ac 1 -f s16le clip.pcm)
import { inference, stt, initializeLogger } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
initializeLogger({ pretty: false, level: "error" });
import { readFileSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: new URL("./.env.local", `file://${process.cwd()}/`).pathname, override: true });

const [, , model, file] = process.argv;
if (!model || !file) {
  console.error("usage: tsx stt-ab.ts <model> <pcmfile>");
  process.exit(1);
}

const pcm = readFileSync(file);
const ab = new ArrayBuffer(pcm.byteLength);
new Uint8Array(ab).set(pcm);
const samples = new Int16Array(ab);

const SAMPLE_RATE = 16000;
const FRAME = 1600; // 100ms

// exit shortly after all audio (plus silence tail) has been streamed
const clipMs = (samples.length / SAMPLE_RATE) * 1000;
setTimeout(() => {
  console.log("== end of audio + 8s");
  process.exit(0);
}, clipMs + 2_500 + 8_000);

const keyterms = process.argv[4]?.split(",");
const engine = new inference.STT({
  model: model as never,
  language: "en",
  ...(keyterms ? { modelOptions: { keyterm: keyterms } as never } : {}),
});
const stream = engine.stream();
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

(async () => {
  for (let i = 0; i < samples.length; i += FRAME) {
    const chunk = samples.subarray(i, Math.min(i + FRAME, samples.length));
    stream.pushFrame(new AudioFrame(chunk, SAMPLE_RATE, 1, chunk.length));
    await new Promise((r) => setTimeout(r, 100)); // realtime pacing
  }
  const silence = new Int16Array(FRAME);
  for (let i = 0; i < 25; i++) {
    stream.pushFrame(new AudioFrame(silence, SAMPLE_RATE, 1, FRAME));
    await new Promise((r) => setTimeout(r, 100)); // 2.5s tail so endpointing closes
  }
  stream.endInput();
})().catch((e) => {
  console.error("push failed:", e);
  process.exit(1);
});

try {
  for await (const ev of stream) {
    if (ev.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
      const text = ev.alternatives?.[0]?.text ?? "";
      if (text.trim()) console.log(`  [${ts()}] "${text}"`);
    }
  }
  console.log(`== done at ${ts()}`);
} catch (e) {
  console.error(`== STREAM ERROR: ${e instanceof Error ? e.message : e}`);
}
process.exit(0);
