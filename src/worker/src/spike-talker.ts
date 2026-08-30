// Phase-0 Spike A helper: a synthetic participant that joins a room and
// publishes a WAV file as its microphone, then reports what it hears back
// (to verify Brio's TTS track actually reaches subscribers).
// Usage: tsx src/spike-talker.ts <roomName> <identity> <wavPath> [seconds]
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env.local", import.meta.url).pathname, override: true });

const [roomName, identity, wavPath, secondsArg] = process.argv.slice(2);
if (!roomName || !identity || !wavPath) {
  console.error("usage: tsx src/spike-talker.ts <room> <identity> <wav> [seconds]");
  process.exit(1);
}
const runSeconds = Number(secondsArg ?? 25);

// naive WAV parse: find the "data" chunk of a 48kHz mono s16le file
function wavPcm(path: string): Int16Array {
  const buf = readFileSync(path);
  const idx = buf.indexOf(Buffer.from("data"));
  if (idx < 0) throw new Error("no data chunk");
  const size = buf.readUInt32LE(idx + 4);
  const pcm = buf.subarray(idx + 8, idx + 8 + size);
  return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
}

const main = async () => {
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity },
  );
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const jwt = await token.toJwt();

  const room = new Room();
  let heardFromBrio = 0;
  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    console.log(`[talker:${identity}] hearing audio from ${participant.identity}`);
    const frames = new AudioStream(track);
    void (async () => {
      for await (const _ of frames) heardFromBrio++;
    })();
  });

  await room.connect(process.env.LIVEKIT_URL!, jwt, { autoSubscribe: true, dynacast: false });
  console.log(`[talker:${identity}] connected to "${roomName}"`);

  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack(`${identity}-mic`, source);
  await room.localParticipant?.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );

  const pcm = wavPcm(wavPath);
  const samplesPer10ms = 480;
  const deadline = Date.now() + runSeconds * 1000;
  while (Date.now() < deadline) {
    for (let off = 0; off + samplesPer10ms <= pcm.length && Date.now() < deadline; off += samplesPer10ms) {
      // .slice (copy, byteOffset 0), NOT .subarray (view) — the native capture
      // path appears to read data.buffer without honoring byteOffset
      const chunk = pcm.slice(off, off + samplesPer10ms);
      await source.captureFrame(new AudioFrame(chunk, 48000, 1, samplesPer10ms));
    }
    // ~1.5s of silence between repetitions so STT endpoints the utterance
    const silence = new Int16Array(samplesPer10ms);
    for (let i = 0; i < 150 && Date.now() < deadline; i++) {
      await source.captureFrame(new AudioFrame(silence, 48000, 1, samplesPer10ms));
    }
  }

  console.log(`[talker:${identity}] done; audio frames heard from others: ${heardFromBrio}`);
  await room.disconnect();
  process.exit(0);
};

void main();
