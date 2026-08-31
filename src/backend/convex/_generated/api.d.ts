/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as engine from "../engine.js";
import type * as intents from "../intents.js";
import type * as interactions from "../interactions.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_constraints from "../lib/constraints.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_participation from "../lib/participation.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_triggers from "../lib/triggers.js";
import type * as livekit from "../livekit.js";
import type * as notes from "../notes.js";
import type * as sessions from "../sessions.js";
import type * as spikes from "../spikes.js";
import type * as therapist from "../therapist.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  engine: typeof engine;
  intents: typeof intents;
  interactions: typeof interactions;
  "lib/constants": typeof lib_constants;
  "lib/constraints": typeof lib_constraints;
  "lib/llm": typeof lib_llm;
  "lib/participation": typeof lib_participation;
  "lib/prompts": typeof lib_prompts;
  "lib/triggers": typeof lib_triggers;
  livekit: typeof livekit;
  notes: typeof notes;
  sessions: typeof sessions;
  spikes: typeof spikes;
  therapist: typeof therapist;
  worker: typeof worker;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
