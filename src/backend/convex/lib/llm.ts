// The one OpenAI code path. Plain fetch (works in Convex's default runtime),
// strict structured output, no retries — a failed call means no card, and the
// trigger simply fires again on a later tick.
import { MODELS } from "./constants";

export async function callStructured(args: {
  apiKey: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<{ parsed: unknown; raw: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: MODELS.actor,
      reasoning_effort: "minimal", // mandatory: default reasoning adds ~5s (see agent-notes)
      max_completion_tokens: args.maxTokens,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, strict: true, schema: args.schema },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string | null; refusal: string | null } }[];
  };
  const msg = data.choices[0]?.message;
  if (!msg?.content) throw new Error(`OpenAI returned no content${msg?.refusal ? `: ${msg.refusal}` : ""}`);
  return { parsed: JSON.parse(msg.content), raw: msg.content, ms: Date.now() - t0 };
}

/** JSON-schema helper: a strict string enum, or null. */
export function enumOrNull(values: string[]): Record<string, unknown> {
  return values.length > 0
    ? { anyOf: [{ type: "string", enum: values }, { type: "null" }] }
    : { type: "null" };
}
