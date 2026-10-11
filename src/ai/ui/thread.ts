// The Ask AI conversation for one diagram: what was asked, what the AI answered, what changed, and the
// diagram as it was after each change (for "Revert to here"). Stored in this browser only, per diagram,
// under its own key: never part of the diagram file, its exports or share links. Pure functions plus a
// small storage wrapper, so the caps are unit-tested.

import type { DiagramFile } from "../../model/types";
import { diagramDiff } from "../../model/diagramDiff";
import type { StencilChoice } from "./apply";

export interface ThreadTurn {
  id: string;
  /** Epoch ms. */
  at: number;
  /** What the user asked, in their words ("" for a pasted reply without a request). */
  request: string;
  /** "change" edits the diagram; "explain" only answers; "revert" restored an earlier turn. */
  kind: "change" | "explain" | "revert";
  /** The ids the request was scoped to (Change with AI… on a selection), with their labels then. */
  scope?: { id: string; label: string }[];
  /** The AI's words, shown as plain text (never HTML). */
  reply?: string;
  /** "+3 nodes, +2 connections" or "Added simulation “Storm”"; absent when nothing changed. */
  summary?: string;
  /** Ids added or changed, highlighted while the turn is hovered or focused. */
  changed: string[];
  choices?: StencilChoice[];
  warnings?: string[];
  /** The diagram right after this turn; dropped from older turns to keep storage small. */
  after?: DiagramFile;
  /** "Undo this change" was used. */
  undone?: boolean;
  /** Which engine answered: the copy-paste flow or a connected model. */
  engine?: string;
}

const PREFIX = "diagrams.ai-thread.v1:";
/** Turns kept per diagram, and how many of the newest keep their "after" snapshot. */
export const MAX_TURNS = 40;
export const MAX_SNAPSHOTS = 10;
/** A snapshot bigger than this (as JSON) isn't kept: Revert to here is then unavailable for that turn. */
export const MAX_SNAPSHOT_CHARS = 250_000;
export const MAX_REPLY_CHARS = 4000;

/** The caps, applied before every save. */
export function capThread(turns: readonly ThreadTurn[]): ThreadTurn[] {
  const kept = turns.slice(-MAX_TURNS);
  let snapshots = 0;
  const out: ThreadTurn[] = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    const t = kept[i];
    const reply = t.reply && t.reply.length > MAX_REPLY_CHARS ? `${t.reply.slice(0, MAX_REPLY_CHARS)}…` : t.reply;
    let after = t.after;
    if (after && (snapshots >= MAX_SNAPSHOTS || JSON.stringify(after).length > MAX_SNAPSHOT_CHARS)) after = undefined;
    if (after) snapshots++;
    const next: ThreadTurn = { ...t, reply };
    if (after) next.after = after;
    else delete next.after;
    out.unshift(next);
  }
  return out;
}

/** True when two diagrams have the same content (positions and sizes aside). */
export function sameContent(a: DiagramFile, b: DiagramFile): boolean {
  const d = diagramDiff(a, b);
  return !d.added.count && !d.removed.count && !d.updated.count && !d.metaChanged;
}

/** The turn whose change is the latest thing that happened to the diagram: only it offers "Undo this change". */
export function latestTurn(turns: readonly ThreadTurn[], current: DiagramFile | null): ThreadTurn | undefined {
  const last = [...turns].reverse().find((t) => t.kind !== "explain");
  return last?.after && !last.undone && current && sameContent(current, last.after) ? last : undefined;
}

const keyFor = (documentId: string) => PREFIX + documentId;

export function loadThread(documentId: string): ThreadTurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(documentId)) ?? "null") as { turns?: unknown } | null;
    return Array.isArray(raw?.turns) ? (raw.turns as ThreadTurn[]).filter((t) => t && typeof t.id === "string") : [];
  } catch {
    return [];
  }
}

/** Saves the capped thread; when storage is full, retries without snapshots. False when nothing could be saved. */
export function saveThread(documentId: string, turns: readonly ThreadTurn[]): boolean {
  const key = keyFor(documentId);
  try {
    if (!turns.length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ turns: capThread(turns) }));
    return true;
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify({ turns: capThread(turns).map(({ after: _after, ...t }) => t) }));
      return true;
    } catch {
      return false;
    }
  }
}

let seq = 0;
export const turnId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
