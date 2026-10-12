import type { DiagramGroup, EdgeRelation } from "../../model/types";

// The intermediate graph every infrastructure reader builds (docs/research/imports.md § Pipeline). Readers
// only describe what they found; shared code (resolveStencil, map.ts, layout.ts) turns hints into stencils,
// links into relationships and groups into boundaries. Values from the files never get here: only names.

/** What a reader knows about a component's kind, for resolveStencil. */
export interface StencilHint {
  /** The component's own name ("orders-api"). */
  name: string;
  /** A container image ("postgres:16", "ghcr.io/acme/web:4.2"). */
  image?: string;
  /** Setting names (never values) that hint at a language: SPRING_*, NODE_ENV… */
  env?: readonly string[];
}

export interface ImportComponent {
  key: string;
  label: string;
  sublabel?: string;
  hint: StencilHint;
  /** A stencil the reader is sure of (a topic, the Users entry): resolveStencil is skipped. */
  stencil?: string;
  /** An ImportGroup's key. */
  group?: string;
  props?: Record<string, unknown>;
}

/** Why a link was drawn: the setting name (never its value), or the file's own key. */
export interface Evidence {
  /** "setting": inferred from a setting's value; the rest are the file's own structure. */
  source: "setting" | "depends_on" | "secrets" | "configs" | "ports";
  /** The setting's name ("SPRING_DATASOURCE_URL"). */
  name?: string;
  /** "reads", "writes", "couldn't tell what it reads or writes"… */
  note?: string;
  /** Direction guessed (a `*_TOPIC` that doesn't say whether it's read or written). */
  guess?: boolean;
}

export interface ImportLink {
  from: string;
  to: string;
  relation: EdgeRelation;
  /** Flows only: Message (async) or Request (sync). */
  kind?: "async" | "sync";
  props?: Record<string, unknown>;
  evidence: Evidence;
}

export interface ImportGroup {
  key: string;
  label: string;
  tone?: DiagramGroup["tone"];
}

/** One report row: a name and a fixed reason ("only in profile “debug”", "not among the files you opened"). */
export interface ReportLine {
  name: string;
  reason: string;
}

export interface ImportGraph {
  /** "docker-compose": the format as the report and the toast name it. */
  format: string;
  title: string;
  /** The file names, for the report's title. */
  source: string;
  components: ImportComponent[];
  links: ImportLink[];
  groups: ImportGroup[];
  notDrawn: ReportLine[];
  unread: ReportLine[];
  /** Placement notes ("orders-api is on frontend and backend; shown in backend"). */
  notes: string[];
}

/** A node drawn as a guess: its best stencil, with the alternatives offered as chips. */
export interface ReportGuess {
  nodeId: string;
  label: string;
  stencil: string;
  /** What the guess rests on ("storefront:4.2.0 · NODE_ENV"). */
  evidence?: string;
  alternatives: string[];
}

/** A connection found in a setting: the variable that implied it, never its value. */
export interface ReportConnection {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  evidence: string;
  note?: string;
  guess?: boolean;
}

/**
 * The Import report: kept in memory while the diagram stays open in this tab. Never in the file, a share
 * link or an export.
 */
export interface ImportReport {
  /** The import toast: “Imported “shop” from docker-compose: 15 nodes, 17 connections. 2 guesses.” */
  summary: string;
  format: string;
  source: string;
  title: string;
  nodes: number;
  connections: number;
  boundaries: number;
  guesses: ReportGuess[];
  inferred: ReportConnection[];
  notDrawn: ReportLine[];
  unread: ReportLine[];
  notes: string[];
}
