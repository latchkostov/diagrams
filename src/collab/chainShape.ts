import type { ChainData } from "./epochs";
import type { Wrap } from "./lobby";
import { publicKeyBytes } from "./signing";

// The shapes of a knock-to-join room's chain and wraps, checked structurally wherever they come from (a lobby message,
// this tab's record) before anything reads them. Signatures and authority are checked later (./epochs.ts, ./lobby.ts).

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const key = (v: unknown): v is string => typeof v === "string" && !!publicKeyBytes(v);
const B64_43 = /^[A-Za-z0-9_-]{43}$/;
/** Starts and logs a chain carries at most (one per epoch, and some room). */
const MAX_PARTS = 64;

/** A chain's starts and logs: arrays, each log a scope and an array of entries. */
export function parseChainData(v: unknown): ChainData | undefined {
  if (!isRecord(v) || !Array.isArray(v.starts) || !Array.isArray(v.logs)) return undefined;
  if (v.starts.length > MAX_PARTS || v.logs.length > MAX_PARTS) return undefined;
  if (
    !v.logs.every((l) => isRecord(l) && typeof l.scope === "string" && l.scope.length < 120 && Array.isArray(l.entries))
  )
    return undefined;
  return {
    starts: v.starts,
    logs: (v.logs as { scope: string; entries: unknown[] }[]).map((l) => ({ scope: l.scope, entries: l.entries })),
  };
}

/** Wraps, every one well formed (`max` at most), or undefined. */
export function parseWraps(v: unknown, max: number): Wrap[] | undefined {
  if (!Array.isArray(v) || v.length > max) return undefined;
  const wraps = v.filter(
    (w): w is Wrap =>
      isRecord(w) &&
      typeof w.scope === "string" &&
      w.scope.length < 120 &&
      key(w.to) &&
      key(w.from) &&
      typeof w.fx === "string" &&
      B64_43.test(w.fx) &&
      typeof w.w === "string" &&
      /^[A-Za-z0-9_-]{80}$/.test(w.w) &&
      typeof w.sig === "string" &&
      /^[A-Za-z0-9_-]{86}$/.test(w.sig),
  );
  if (wraps.length !== v.length) return undefined;
  return wraps.map((w) => ({ scope: w.scope, to: w.to, from: w.from, fx: w.fx, w: w.w, sig: w.sig }));
}
