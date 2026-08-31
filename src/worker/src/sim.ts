// npm run demo — a room full of sim kids for Brio to facilitate.
//
//   npm run demo                          create a session, print the link;
//                                         the moment a real person joins as a
//                                         kid, the sims start the exercise
//   npm run demo -- <session url or id>   attach sims to YOUR session — you
//                                         stay the therapist (panel, handoff)
//   add --headless                        no LiveKit/no audio: sim speech is
//                                         written straight to the transcript
//
// Audible mode (default) is the real thing: each sim joins the LiveKit room
// and SPEAKS its lines through TTS, so Brio hears them with its own ears —
// per-track STT, merge-at-write, the delivery gate, everything. Headless mode
// drives the same personas through worker.recordUtterance instead (no media
// stack needed, still exercises the whole brain).
//
// The cast (./personas.ts): Dax the dominator, Sana the silent
// one, Theo the tangent-chaser, Effie the eager helper. Sims react to Brio
// for real: an invited kid answers (or stays shy), Effie sends emoji.
import { AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { initializeLogger } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { ConvexClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "@briocare/backend/convex/_generated/api";
import type { Doc, Id } from "@briocare/backend/convex/_generated/dataModel";
import { DEMO_CAST, DEMO_VOICES, type PersonaSpec } from "./personas";

dotenv.config({ path: new URL("../.env.local", import.meta.url).pathname, override: true });
initializeLogger({ pretty: false, level: "error" });

const args = process.argv.slice(2).filter((a) => a !== "--");
const headless = args.includes("--headless");
const sessionArg = args.find((a) => !a.startsWith("--"));

const convex = new ConvexClient(process.env.CONVEX_URL!);
type TTSVoice = NonNullable<NonNullable<ConstructorParameters<typeof openai.TTS>[0]>["voice"]>;

type SimKid = {
  spec: PersonaSpec;
  participantId: Id<"participants">;
  speak: (text: string) => Promise<void>; // TTS into the room, or a transcript row
  room?: Room;
  invited: boolean;
};

const log = (msg: string) => console.log(`[demo] ${msg}`);

async function ensureSession(): Promise<{ sessionId: Id<"sessions">; owned: boolean }> {
  if (sessionArg) {
    const raw = sessionArg.split("/").filter(Boolean).pop()!;
    const session = await convex.query(api.sessions.resolve, { sessionId: raw });
    if (!session) throw new Error(`no session found for "${raw}"`);
    if (session.status === "ended") throw new Error("that session has already ended");
    return { sessionId: session._id, owned: false };
  }
  const { sessionId } = await convex.mutation(api.sessions.create, {
    therapistName: "Dr. River",
    exerciseDescription: "Share one favorite thing from this week — a moment, a thing, or a person.",
  });
  return { sessionId, owned: true };
}

async function joinAudible(sessionId: Id<"sessions">, spec: PersonaSpec, participantId: Id<"participants">) {
  const conn = await convex.action(api.livekit.mintRoomToken, { sessionId, participantId });
  if (!conn) throw new Error("LiveKit env not configured on the deployment — use --headless");
  // apiKey passed explicitly: the plugin's default captures process.env at
  // module load, which is BEFORE our dotenv line runs (imports hoist).
  const tts = new openai.TTS({
    model: "gpt-4o-mini-tts",
    voice: (DEMO_VOICES[spec.name] ?? "alloy") as TTSVoice,
    apiKey: process.env.OPENAI_API_KEY,
  });
  const room = new Room();
  await room.connect(conn.serverUrl, conn.token, { autoSubscribe: true, dynacast: false });
  const source = new AudioSource(tts.sampleRate, 1);
  const track = LocalAudioTrack.createAudioTrack(`sim-${spec.name}`, source);
  await room.localParticipant?.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  let speaking = Promise.resolve();
  const speak = (text: string) => {
    // serialize: a sim never talks over itself
    speaking = speaking.then(async () => {
      log(`🗣 ${spec.name}: "${text}"`);
      for await (const audio of tts.synthesize(text)) await source.captureFrame(audio.frame);
    });
    return speaking;
  };
  return { room, speak };
}

function headlessSpeak(sessionId: Id<"sessions">, spec: PersonaSpec, participantId: Id<"participants">) {
  return async (text: string) => {
    log(`🗣 ${spec.name} (transcript): "${text}"`);
    const now = Date.now();
    const durMs = Math.max(1_200, text.length * 60);
    await convex.mutation(api.worker.recordUtterance, {
      sessionId,
      participantId,
      startAt: now - durMs,
      endAt: now,
      text,
      sttOk: true,
    });
    await convex.mutation(api.worker.bumpAirtime, { sessionId, participantId, deltaMs: durMs, at: now });
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { sessionId, owned } = await ensureSession();
  const link = `http://localhost:5173/s/${sessionId}`;

  const kids: SimKid[] = [];
  for (const spec of DEMO_CAST) {
    const { participantId } = await convex.mutation(api.sessions.join, { sessionId, name: spec.name });
    kids.push({ spec, participantId, speak: headlessSpeak(sessionId, spec, participantId), invited: false });
  }
  log(`${kids.length} sim kids joined: ${kids.map((k) => k.spec.name).join(", ")}`);
  console.log(`\n  👉 therapist link: ${link}\n`);
  if (owned) {
    log("open the link and join with your name — the session starts on its own once you're in.");
    log("(you'll be a kid in the group; Brio and the sims run the room. Ctrl-C stops the sims.)");
  } else {
    log("your session, your controls: press Start, then the green “Hand to Brio” on Brio's tile.");
  }

  // Owned mode: wait for one real human to join (or 90s), then start.
  if (owned) {
    const t0 = Date.now();
    for (;;) {
      const roster = await convex.query(api.sessions.roster, { sessionId });
      const humans = roster.filter(
        (p: Doc<"participants">) => p.role === "child" && !kids.some((k) => k.participantId === p._id),
      );
      if (humans.length > 0) {
        log(`${humans[0].name} joined — starting the session.`);
        break;
      }
      if (Date.now() - t0 > 90_000) {
        log("no one joined in 90s — starting anyway (sims only).");
        break;
      }
      await sleep(1_500);
    }
    await convex.mutation(api.sessions.start, { sessionId });
  }

  // Wait for the session to be active (attach mode: the therapist starts it).
  for (;;) {
    const s = await convex.query(api.sessions.get, { sessionId });
    if (s?.status === "active") break;
    if (s?.status === "ended") return log("session ended before it began — bye.");
    await sleep(1_500);
  }

  // Media joins happen once active (the room now exists and Brio is on the way).
  if (!headless) {
    for (const kid of kids) {
      const { room, speak } = await joinAudible(sessionId, kid.spec, kid.participantId);
      kid.room = room;
      kid.speak = speak;
    }
    log("sims are in the room and audible.");
  }

  // Owned mode presses the handoff itself; attach mode waits for the human.
  if (owned) {
    await sleep(4_000); // let Brio's worker connect before the introduce
    await convex.mutation(api.therapist.requestMove, {
      sessionId,
      move: "introduce",
      cueText:
        "You have just been handed the room. Introduce yourself briefly, then open today's exercise and invite the first share — no names, passing is always okay.",
    });
    log("handed the room to Brio.");
  } else {
    log("waiting for you to hand the room to Brio…");
  }
  let handoffAt: number | null = null;
  for (;;) {
    const feed = await convex.query(api.intents.feed, { sessionId });
    const intro = feed.find((i: Doc<"agentIntents">) => i.type === "introduce" && i.voicedAt !== undefined);
    if (intro) {
      handoffAt = intro.voicedAt!;
      break;
    }
    await sleep(1_000);
  }
  log("Brio has the room — the kids begin.");

  // ---- the live persona loop ------------------------------------------
  const fired = new Set<string>();
  const reacted = new Set<string>();
  for (;;) {
    const s = await convex.query(api.sessions.get, { sessionId });
    if (!s || s.status === "ended") break;
    const now = Date.now();
    const since = now - handoffAt!;

    for (const kid of kids) {
      for (const line of kid.spec.script) {
        const key = `${kid.spec.name}:${line.at}`;
        if (!fired.has(key) && since >= line.at) {
          fired.add(key);
          void kid.speak(line.text);
        }
      }
    }

    const feed = await convex.query(api.intents.feed, { sessionId });
    for (const i of feed as Doc<"agentIntents">[]) {
      if (i.voicedAt === undefined || reacted.has(i._id)) continue;
      reacted.add(i._id);
      const target = kids.find((k) => k.participantId === i.targetParticipantId);
      if (target?.spec.onInvited && !target.invited && i.type !== "affirm") {
        target.invited = true;
        const r = target.spec.onInvited;
        setTimeout(() => void target.speak(r.text), r.afterMs);
      }
      for (const kid of kids) {
        if (kid.spec.reactsToBrio) {
          setTimeout(() => {
            void convex.mutation(api.interactions.recordAction, {
              sessionId,
              participantId: kid.participantId,
              type: "reaction",
              details: { emoji: "👍" },
            });
          }, 1_200);
        }
      }
    }
    await sleep(700);
  }

  log("session ended — the link is now the review page. Bye!");
  for (const kid of kids) await kid.room?.disconnect();
  await convex.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("[demo] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
