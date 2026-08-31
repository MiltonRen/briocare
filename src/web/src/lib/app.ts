// Tiny client-side helpers. The only "auth" in v0 is: you hold the session
// URL, and localStorage remembers which participant you are in it.
import { useEffect, useState } from "react";

// Identity is per-tab (sessionStorage), so several tabs in ONE browser can be
// several people — the therapist demoing with kid tabs. The session's CREATOR
// also persists to localStorage; a fresh tab never impersonates silently, it
// just gets a "continue as …" offer on the join screen.
export function storeIdentity(sessionId: string, participantId: string, persist = false) {
  sessionStorage.setItem(`briocare:${sessionId}`, participantId);
  if (persist) localStorage.setItem(`briocare:${sessionId}`, participantId);
}
/** Who this TAB is (authoritative). */
export function getIdentity(sessionId: string): string | null {
  return sessionStorage.getItem(`briocare:${sessionId}`);
}
/** Who this BROWSER created (offered as a one-click resume). */
export function getPersistedIdentity(sessionId: string): string | null {
  return localStorage.getItem(`briocare:${sessionId}`);
}

/** Wall-clock for queries (Convex queries must not read the clock). */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const fmtClock = (ms: number, since: number) => {
  const s = Math.max(0, Math.round((ms - since) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const fmtDur = (ms: number) => {
  const min = Math.floor(ms / 60000);
  return min >= 1 ? `${min} min` : `${Math.round(ms / 1000)}s`;
};
