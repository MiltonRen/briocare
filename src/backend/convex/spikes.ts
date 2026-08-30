import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";

// Phase-0 Spike B: prove the actor round-trip — one OpenAI call with a strict
// JSON schema returning a structured decision. Throwaway; delete before submit.

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["draw_out", "do_nothing"] },
    target: { type: ["string", "null"] },
    utterance: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["action", "target", "utterance", "reason"],
} as const;

export const actorSmoke = internalAction({
  args: {},
  returns: v.object({
    action: v.string(),
    target: v.union(v.string(), v.null()),
    utterance: v.union(v.string(), v.null()),
    reason: v.string(),
    model: v.string(),
    ms: v.number(),
  }),
  handler: async (_ctx) => {
    const start = Date.now();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        reasoning_effort: "minimal",
        messages: [
          {
            role: "system",
            content:
              "You are Brio, a warm AI co-facilitator in a children's group therapy session, working under a therapist's supervision. When woken you receive context, a recommended action, and a menu of legal actions. Choose exactly one action from the menu. Silence (do_nothing) is usually the right answer. If you speak: at most two sentences, warm and low-pressure, invitations always offer a pass, no clinical language, never compare children.",
          },
          {
            role: "user",
            content:
              "Exercise: sharing one thing that made you happy this week.\n" +
              "Roster: maya (weight 1, airtime 12s, 1 reaction, quiet 14 min), leo (weight 1, airtime 6m), zoe (weight 1, airtime 4m).\n" +
              "Recent transcript: leo: '...and then we won the soccer game!' / zoe: 'I got a new puppy this week!'\n" +
              "Recommendation: draw_out(target=maya, level=0 unnamed group cue) — reason: quietest 14 min, share far below expectation.\n" +
              "Menu: draw_out, do_nothing.",
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "actor_decision",
            strict: true,
            schema: DECISION_SCHEMA,
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const decision = JSON.parse(data.choices[0].message.content);
    return { ...decision, model: data.model, ms: Date.now() - start };
  },
});
