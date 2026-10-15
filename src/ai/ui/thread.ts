// The AI panel's conversation for one diagram: what agents (or pasted replies) changed and said, what changed, and the
// diagram as it was after each change (for "Revert to here"). Stored in this browser only, per diagram,
// under its own key: never part of the diagram file, its exports or share links. Pure functions plus a
// small storage wrapper, so the caps are unit-tested.

import type { DiagramFile } from "../../model/types";
import { validateDiagram } from "../../interop/native";
import type { StencilChoice } from "./apply";
import { AI_THREAD_PREFIX } from "../../lib/aiThreadKey";
import { retainedExampleConversation, saveExampleConversation } from "../../lib/exampleConversations";
import { safeStorage } from "../../lib/storage";

export interface ThreadTurn {
  id: string;
  /** Epoch ms. */
  at: number;
  /** What the user asked, in their words ("" for a pasted reply without a request). */
  request: string;
  /** "change" edits the diagram; "explain" only answers; "revert" restored an earlier turn. */
  kind: "change" | "explain" | "revert";
  /** A revert's original target label, without app-generated or translated words; empty means "this change". */
  revertLabel?: string;
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
  /**
   * The editor history step this turn made (its applyDiagram `merge` tag): Undo this change is offered
   * only while that step is the one Undo would reverse.
   */
  historyKey?: string;
  /** Who made the change: "agent" (a browser agent through WebMCP) or "paste" (Advanced, copy and paste). */
  engine?: string;
  /** For an agent's change, the tool it called (edit_diagram, set_simulation, new_diagram). */
  tool?: string;
}

const PREFIX = AI_THREAD_PREFIX;
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

const contentKeys = new WeakMap<DiagramFile, string>();

/**
 * The diagram's content as text, positions and boundary sizes aside (cached per diagram object, so a
 * render compares strings instead of diffing whole diagrams).
 */
export function contentKey(d: DiagramFile): string {
  let key = contentKeys.get(d);
  if (key === undefined) {
    const place = <T extends object>(items: readonly T[] | undefined, size: boolean) =>
      (items ?? []).map((item) => {
        const rest: Record<string, unknown> = { ...(item as Record<string, unknown>) };
        delete rest.x;
        delete rest.y;
        if (size) {
          delete rest.width;
          delete rest.height;
        }
        return rest;
      });
    key = JSON.stringify([
      d.title,
      d.description,
      d.direction,
      place(d.nodes, false),
      d.edges,
      place(d.groups, true),
      place(d.annotations, false),
      d.simulations ?? [],
    ]);
    contentKeys.set(d, key);
  }
  return key;
}

/** True when two diagrams have the same content (positions and sizes aside). */
export const sameContent = (a: DiagramFile, b: DiagramFile) => contentKey(a) === contentKey(b);

const KINDS = new Set(["change", "explain", "revert"]);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** A stored turn, checked field by field: anything malformed is dropped, never rendered. */
export function validTurn(raw: unknown): ThreadTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || typeof t.request !== "string" || !KINDS.has(t.kind as string)) return null;
  const turn: ThreadTurn = {
    id: t.id,
    at: typeof t.at === "number" ? t.at : 0,
    request: t.request,
    kind: t.kind as ThreadTurn["kind"],
    changed: isStringArray(t.changed) ? t.changed : [],
  };
  if (typeof t.reply === "string") turn.reply = t.reply;
  if (turn.kind === "revert" && typeof t.revertLabel === "string") turn.revertLabel = t.revertLabel;
  if (typeof t.summary === "string") turn.summary = t.summary;
  if (typeof t.engine === "string") turn.engine = t.engine;
  if (typeof t.tool === "string") turn.tool = t.tool;
  if (typeof t.historyKey === "string") turn.historyKey = t.historyKey;
  if (t.undone === true) turn.undone = true;
  if (isStringArray(t.warnings)) turn.warnings = t.warnings;
  if (Array.isArray(t.scope))
    turn.scope = t.scope.filter(
      (s): s is { id: string; label: string } =>
        !!s && typeof s === "object" && typeof s.id === "string" && typeof s.label === "string",
    );
  if (Array.isArray(t.choices))
    turn.choices = t.choices.filter(
      (c): c is StencilChoice =>
        !!c &&
        typeof c === "object" &&
        typeof c.nodeId === "string" &&
        typeof c.kind === "string" &&
        !!c.stencil &&
        typeof c.stencil.id === "string" &&
        Array.isArray(c.stencil.alternatives),
    );
  if (t.after !== undefined) {
    const checked = validateDiagram(t.after);
    if (checked.ok) turn.after = checked.diagram;
  }
  return turn;
}

const keyFor = (documentId: string) => PREFIX + documentId;

export function loadThread(documentId: string): ThreadTurn[] {
  try {
    const retained = retainedExampleConversation(documentId);
    const raw = JSON.parse(
      (retained === undefined ? localStorage.getItem(keyFor(documentId)) : retained) ?? "null",
    ) as { turns?: unknown } | null;
    if (!Array.isArray(raw?.turns)) return [];
    return capThread(raw.turns.map(validTurn).filter((t): t is ThreadTurn => !!t));
  } catch {
    return [];
  }
}

/** Saves the capped thread; when storage is full, retries without snapshots. False when nothing could be saved. */
export function saveThread(documentId: string, turns: readonly ThreadTurn[]): boolean {
  const key = keyFor(documentId);
  // Through safe storage, like every write: blocked or full storage is a false, never a throw, and a tab from before
  // Clear everything on this device writes nothing (./lib/storage.ts).
  const complete = turns.length ? JSON.stringify({ turns: capThread(turns) }) : null;
  const write = (raw: string | null) =>
    saveExampleConversation(documentId, raw, complete) ??
    (raw === null ? safeStorage.removeItem(key) : safeStorage.setItem(key, raw));
  if (!turns.length) return write(null);
  return write(complete) || write(JSON.stringify({ turns: capThread(turns).map(({ after: _after, ...t }) => t) }));
}

let seq = 0;
export const turnId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
