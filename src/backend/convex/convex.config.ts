import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    LIVEKIT_URL: v.optional(v.string()),
    LIVEKIT_API_KEY: v.optional(v.string()),
    LIVEKIT_API_SECRET: v.optional(v.string()),
  },
});

export default app;
