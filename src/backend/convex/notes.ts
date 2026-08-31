// End-of-session notes: ONE LLM call writes drafts for ALL children —
// counts first, quotes only the child's own words, no clinical inference.
// The therapist edits from there; auto-generation never overwrites edits.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  action,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { buildNotesUser, NOTES_SYSTEM } from "./lib/prompts";
import { callStructured } from "./lib/llm";

type NotesContext = {
  exerciseDescription: string;
  durationMin: number;
  children: {
    id: Id<"participants">;
    name: string;
    airtimeMs: number;
    utteranceCount: number;
    actionCount: number;
    preSessionNote: string | null;
    quotes: string[];
  }[];
} | null;

export const context = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.any(),
  handler: async (ctx, args): Promise<NotesContext> => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) return null;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    const children = [];
    for (const p of participants) {
      if (p.role !== "child") continue;
      const rows = await ctx.db
        .query("utterances")
        .withIndex("by_sessionId_and_participantId", (q) =>
          q.eq("sessionId", args.sessionId).eq("participantId", p._id),
        )
        .order("desc")
        .take(200);
      const spoken = rows.filter((u) => u.sttOk && u.text.trim().length > 0);
      children.push({
        id: p._id,
        name: p.name,
        airtimeMs: p.airtimeMs,
        utteranceCount: rows.length, // capped at 200 — plenty for a session
        actionCount: p.actionCount,
        preSessionNote: p.preSessionNote ?? null,
        quotes: spoken.slice(0, 6).map((u) => u.text),
      });
    }
    const durationMin =
      session.startedAt && session.endedAt
        ? Math.max(1, Math.round((session.endedAt - session.startedAt) / 60000))
        : 0;
    return { exerciseDescription: session.exerciseDescription, durationMin, children };
  },
});

async function run(ctx: ActionCtx, sessionId: Id<"sessions">, overwrite: boolean) {
  const data: NotesContext = await ctx.runQuery(internal.notes.context, { sessionId });
  if (!data || data.children.length === 0) return;
  if (!env.OPENAI_API_KEY) {
    console.warn("[notes] OPENAI_API_KEY not set — skipping note drafts");
    return;
  }
  const user = buildNotesUser(data);
  const schema = {
    type: "object",
    properties: {
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            participantId: { type: "string", enum: data.children.map((c) => c.id as string) },
            note: { type: "string" },
          },
          required: ["participantId", "note"],
          additionalProperties: false,
        },
      },
    },
    required: ["notes"],
    additionalProperties: false,
  };
  const { parsed, ms } = await callStructured({
    apiKey: env.OPENAI_API_KEY,
    system: NOTES_SYSTEM,
    user,
    schemaName: "session_notes",
    schema,
    maxTokens: 1600,
  });
  const entries = (parsed as { notes: { participantId: string; note: string }[] }).notes;
  console.log(`[notes] drafted ${entries.length} notes in ${ms}ms`);
  await ctx.runMutation(internal.notes.save, { sessionId, entries, overwrite });
}

export const generate = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await run(ctx, args.sessionId, false);
    } catch (e) {
      console.error("[notes] generation failed:", e); // therapist can hit Regenerate
    }
    return null;
  },
});

/** Review-page button. Overwrites existing drafts on request. */
export const regenerate = action({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await run(ctx, args.sessionId, true);
    return null;
  },
});

export const save = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    entries: v.array(v.object({ participantId: v.string(), note: v.string() })),
    overwrite: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      const id = ctx.db.normalizeId("participants", entry.participantId);
      if (!id) continue;
      const participant = await ctx.db.get("participants", id);
      if (!participant || participant.sessionId !== args.sessionId) continue;
      if (participant.role !== "child") continue;
      if (!args.overwrite && participant.postSessionNote) continue;
      await ctx.db.patch("participants", id, { postSessionNote: entry.note });
    }
    return null;
  },
});
