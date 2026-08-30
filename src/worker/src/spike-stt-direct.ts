// Isolation test: push a 16 kHz mono WAV straight into inference.STT and dump
// every event verbatim. No LiveKit room involved.
import { inference, initializeLogger } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env.local", import.meta.url).pathname, override: true });
initializeLogger({ pretty: true, level: "warn" });

const wavPath = process.argv[2];
const buf = readFileSync(wavPath);
const idx = buf.indexOf(Buffer.from("data"));
const size = buf.readUInt32LE(idx + 4);
const pcmBuf = buf.subarray(idx + 8, idx + 8 + size);
const pcm = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, Math.floor(pcmBuf.byteLength / 2));
console.log(`[direct] ${pcm.length} samples (${(pcm.length / 16000).toFixed(1)}s @16k)`);

const sttEngine = new inference.STT({ model: "deepgram/nova-3", language: "en" });
const stream = sttEngine.stream();

const push = async () => {
  const chunk = 160; // 10ms @16k
  for (let off = 0; off + chunk <= pcm.length; off += chunk) {
    stream.pushFrame(new AudioFrame(pcm.subarray(off, off + chunk), 16000, 1, chunk));
    await new Promise((r) => setTimeout(r, 10)); // realtime-ish pacing
  }
  // trailing silence so the endpointer closes the utterance
  const silence = new Int16Array(chunk);
  for (let i = 0; i < 200; i++) {
    stream.pushFrame(new AudioFrame(silence, 16000, 1, chunk));
    await new Promise((r) => setTimeout(r, 10));
  }
  stream.endInput();
};
void push();

const timeout = setTimeout(() => {
  console.log("[direct] timeout, exiting");
  process.exit(0);
}, 40000);

for await (const ev of stream) {
  console.log(`[direct][event] ${JSON.stringify(ev)}`);
}
clearTimeout(timeout);
