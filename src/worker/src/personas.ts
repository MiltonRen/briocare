// Sim personas for the demo (sim.ts): pure content, no imports.
// Offsets are milliseconds AFTER THE HANDOFF (Brio's introduce voiced).

export type PersonaLine = { at: number; text: string; durMs: number };

export type PersonaSpec = {
  name: string;
  /** expectedParticipationWeight; default 1 */
  weight?: number;
  /** proactive speech, offsets from the handoff */
  script: PersonaLine[];
  /** what they do the first time Brio personally invites them (executed, targeted) */
  onInvited?:
    | { kind: "answer"; afterMs: number; text: string; durMs: number }
    | { kind: "pass"; afterMs: number; text: string };
  /** reacts with an emoji shortly after each Brio voiced line */
  reactsToBrio?: boolean;
};

export const DOMINATOR: PersonaSpec = {
  name: "Dax",
  script: [
    { at: 4_000, text: "My favorite thing was my soccer game, I scored two goals and everyone cheered.", durMs: 6_000 },
    { at: 16_000, text: "Also my cousin came over and we built a huge fort out of every blanket in the house.", durMs: 6_500 },
    { at: 30_000, text: "And then we watched three movies in a row, I picked all of them.", durMs: 5_500 },
    { at: 46_000, text: "Oh and I forgot, I also got new cleats, they are red with white stripes.", durMs: 6_000 },
    { at: 64_000, text: "My dad says I might make the travel team next year if I keep practicing.", durMs: 6_000 },
    { at: 84_000, text: "One more thing, at recess I won the race around the whole field twice.", durMs: 6_000 },
  ],
};

export const SILENT_ONE: PersonaSpec = {
  name: "Sana",
  script: [],
  onInvited: { kind: "answer", afterMs: 4_000, text: "Um, I have a cat named Mochi. She sleeps on my homework.", durMs: 4_500 },
};

export const TANGENT_CHASER: PersonaSpec = {
  name: "Theo",
  script: [
    { at: 24_000, text: "Did you know a T-rex could not clap because its arms were too short?", durMs: 5_000 },
    { at: 56_000, text: "Wait, what would win, a velociraptor or a really big goose?", durMs: 4_500 },
  ],
  onInvited: { kind: "answer", afterMs: 3_500, text: "My favorite thing was the dinosaur book I got from the library.", durMs: 4_500 },
};

export const EAGER_HELPER: PersonaSpec = {
  name: "Effie",
  reactsToBrio: true,
  script: [
    { at: 9_000, text: "My favorite thing was baking cookies with my grandma, we made a triple batch!", durMs: 5_000 },
    { at: 38_000, text: "Sana, your cat sounds so cute!", durMs: 2_500 },
  ],
};

export const PASSER: PersonaSpec = {
  name: "Pia",
  script: [],
  onInvited: { kind: "pass", afterMs: 3_000, text: "No, I'm good." },
};

/** One watchlist line, verbatim from constants.WATCHLIST — the distress scenario. */
export const DISTRESS_KID: PersonaSpec = {
  name: "Danny",
  script: [
    { at: 20_000, text: "My week was okay I guess.", durMs: 3_000 },
    { at: 42_000, text: "Sometimes I feel like nobody loves me.", durMs: 3_500 },
  ],
};

/** The demo cast (audible or headless) — one of each archetype. */
export const DEMO_CAST: PersonaSpec[] = [DOMINATOR, SILENT_ONE, TANGENT_CHASER, EAGER_HELPER];

/** TTS voices for the audible demo, by persona name (OpenAI gpt-4o-mini-tts). */
export const DEMO_VOICES: Record<string, string> = {
  Dax: "echo",
  Sana: "coral",
  Theo: "verse",
  Effie: "alloy",
};
