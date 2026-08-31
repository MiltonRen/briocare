"use node"; // livekit-server-sdk needs node:crypto — actions only in this file
// LiveKit glue: room tokens for browsers, explicit agent dispatch for the
// media worker. Room name = sessionId; participant identity = participant
// _id. Keys never leave the server — clients only ever see short-lived JWTs.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, env, internalAction } from "./_generated/server";
import { AGENT_NAME } from "./lib/constants";
// livekit-server-sdk is imported lazily inside handlers: it needs node:crypto,
// and a top-level import would make this module unloadable in the keyless
// edge-runtime test environment (which never reaches the imports — the env
// guards return first).

export const mintRoomToken = action({
  args: { sessionId: v.string(), participantId: v.string() },
  returns: v.union(v.object({ serverUrl: v.string(), token: v.string() }), v.null()),
  handler: async (ctx, args): Promise<{ serverUrl: string; token: string } | null> => {
    const participant: { name: string; role: string; sessionId: string } | null =
      await ctx.runQuery(internal.worker.participantForToken, {
        sessionId: args.sessionId,
        participantId: args.participantId,
      });
    if (!participant) return null;
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      console.warn("[livekit] env not configured — video disabled");
      return null;
    }
    const { AccessToken } = await import("livekit-server-sdk");
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: args.participantId,
      name: participant.name,
      ttl: "6h",
    });
    token.addGrant({
      room: participant.sessionId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return { serverUrl: env.LIVEKIT_URL, token: await token.toJwt() };
  },
});

/** Called from sessions.start: ask LiveKit to hand this room to the "brio"
 * agent (the media worker). Failure degrades gracefully — the session runs,
 * Brio is just absent. */
export const dispatchAgent = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      console.warn("[livekit] env not configured — agent dispatch skipped");
      return null;
    }
    const httpUrl = env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    try {
      const { AgentDispatchClient } = await import("livekit-server-sdk");
      const client = new AgentDispatchClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
      await client.createDispatch(args.sessionId, AGENT_NAME, { metadata: args.sessionId });
      console.log(`[livekit] dispatched agent "${AGENT_NAME}" to room ${args.sessionId}`);
    } catch (e) {
      console.error("[livekit] agent dispatch failed:", e);
    }
    return null;
  },
});
