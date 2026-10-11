import type { DiagramEdge, EdgeRelation } from "./types";

// Relationships: what an edge means (docs/research/diagram-semantics.md §2). A flow carries messages
// or requests; the six dependencies (config, secret, identity, telemetry, deploy, depends) never carry
// traffic, share one dotted line style, and differ by a glyph and a muted tint. Pure helpers, shared
// by the file format, the canvas, the editor, the simulation filter and the importers / exporters.

export const EDGE_RELATIONS: readonly EdgeRelation[] = [
  "flow",
  "config",
  "secret",
  "identity",
  "telemetry",
  "deploy",
  "depends",
];

export type DependencyRelation = Exclude<EdgeRelation, "flow">;
export const DEPENDENCY_RELATIONS = EDGE_RELATIONS.filter((r): r is DependencyRelation => r !== "flow");

export const isEdgeRelation = (v: unknown): v is EdgeRelation =>
  typeof v === "string" && (EDGE_RELATIONS as readonly string[]).includes(v);

/** The edge's relationship; absent or unknown reads as a flow (the safe fallback). */
export const relationOf = (e: { relation?: unknown } | undefined): EdgeRelation =>
  e && isEdgeRelation(e.relation) ? e.relation : "flow";

export const isDependency = (e: { relation?: unknown } | undefined): boolean => relationOf(e) !== "flow";

/** Only the edges that carry traffic: what the simulation, capacity analysis and trace see. */
export const flowEdges = <T extends { relation?: unknown }>(edges: readonly T[]): T[] =>
  edges.some(isDependency) ? edges.filter((e) => !isDependency(e)) : (edges as T[]);

export interface RelationMeta {
  /** Menu and inspector word ("Secret"). */
  label: string;
  /** Implicit label, never drawn: tooltip, aria label, exports ("reads secrets"). */
  implicit: string;
  /** One line for the menu row's hint / tooltip. */
  hint: string;
  /** How a sentence names it ("Secret dependency"). */
  noun: string;
}

export const RELATION_META: Record<DependencyRelation, RelationMeta> = {
  config: {
    label: "Config",
    implicit: "reads config",
    hint: "Settings it loads, then refreshes",
    noun: "Config dependency",
  },
  secret: {
    label: "Secret",
    implicit: "reads secrets",
    hint: "Secrets it resolves, usually once",
    noun: "Secret dependency",
  },
  identity: {
    label: "Identity",
    implicit: "gets tokens from",
    hint: "Who it authenticates as",
    noun: "Identity dependency",
  },
  telemetry: {
    label: "Telemetry",
    implicit: "sends telemetry to",
    hint: "Logs, metrics and traces",
    noun: "Telemetry",
  },
  deploy: { label: "Deploys", implicit: "deploys to", hint: "Changes it: CI/CD, IaC, GitOps", noun: "Deployment" },
  depends: { label: "Depends on", implicit: "depends on", hint: "Needed to start or connect", noun: "Dependency" },
};

/** "Secret", or "Message" / "Request" for a flow. */
export function relationLabel(relation: EdgeRelation, kind?: "async" | "sync"): string {
  return relation === "flow" ? (kind === "sync" ? "Request" : "Message") : RELATION_META[relation].label;
}

/** "reads secrets", or "request" / "message" for a flow (the words edge aria labels always used). */
export function implicitLabel(relation: EdgeRelation, kind?: "async" | "sync"): string {
  return relation === "flow" ? (kind === "sync" ? "request" : "message") : RELATION_META[relation].implicit;
}

// ---------------------------------------------------------------- settings on config edges

/** One setting read over a config edge; `secret` = its value lives in (references) a secret store. */
export interface ConfigSetting {
  key: string;
  secret?: boolean;
}

export const MAX_SETTINGS = 200;
export const MAX_SETTING_KEY = 200;

/** Settings from `props.settings`, tolerating anything malformed (skipped, never thrown). */
export function edgeSettings(e: Pick<DiagramEdge, "props"> | { props?: Record<string, unknown> } | undefined) {
  return sanitizeSettings(e?.props?.settings) ?? [];
}

/** Valid `{ key, secret? }` entries (trimmed, deduplicated, bounded), or undefined when there are none. */
export function sanitizeSettings(raw: unknown): ConfigSetting[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ConfigSetting[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_SETTINGS) break;
    if (typeof item !== "object" || item === null) continue;
    const { key, secret } = item as { key?: unknown; secret?: unknown };
    if (typeof key !== "string") continue;
    const k = key.trim().slice(0, MAX_SETTING_KEY);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(secret === true ? { key: k, secret: true } : { key: k });
  }
  return out.length ? out : undefined;
}

/** A value that points at a secret store rather than holding the value itself. */
const SECRET_VALUE =
  /@Microsoft\.KeyVault|vault\.azure\.net|application\/vnd\.microsoft\.appconfig\.keyvaultref|\/aws\/reference\/secretsmanager\/|secretsmanager:|"uri"\s*:/i;

/**
 * Forgiving paste parser: one setting per line. A leading `!` (or a lock) marks a secret. Lines from
 * appsettings.json (`"Key": value`), .env / az appconfig output (`key=value`, `key value`) and plain
 * keys all work; values that are Key Vault or Secrets Manager references mark the key secret.
 * Keys may contain `:` (".NET sections") and `/` (parameter paths), so only `"…":` and `=` split.
 */
export function parseSettings(text: string): ConfigSetting[] {
  const whole = parseJsonSettings(text);
  if (whole) return whole;
  const out: ConfigSetting[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/,$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//") || /^[{}[\]]+$/.test(line)) continue;
    let secret = false;
    const marker = /^(!|🔒|\[lock\])\s*/u.exec(line);
    if (marker) {
      secret = true;
      line = line.slice(marker[0].length);
    }
    let key = line;
    let value = "";
    const json = /^"((?:[^"\\]|\\.)*)"\s*:\s*(.*)$/.exec(line);
    if (json) {
      key = json[1];
      value = json[2];
    } else {
      const eq = line.indexOf("=");
      if (eq > 0) {
        key = line.slice(0, eq);
        value = line.slice(eq + 1);
      } else {
        const sp = /\s/.exec(line);
        if (sp) {
          key = line.slice(0, sp.index);
          value = line.slice(sp.index);
        }
      }
    }
    key = key.trim().replace(/^["'`]|["'`]$/g, "");
    if (!key) continue;
    if (SECRET_VALUE.test(value) || /^\/aws\/reference\/secretsmanager\//i.test(key)) secret = true;
    out.push(secret ? { key, secret: true } : { key });
  }
  return sanitizeSettings(out) ?? [];
}

/**
 * A whole pasted JSON document: `az appconfig kv list` (an array of `{ key, value, contentType }`)
 * or an appsettings.json object (nested sections flatten to "Section:Key"). Undefined otherwise.
 */
function parseJsonSettings(text: string): ConfigSetting[] | undefined {
  const t = text.trim();
  if (!/^[[{]/.test(t) || t.length > 1_000_000) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch {
    return undefined;
  }
  const out: ConfigSetting[] = [];
  const isSecret = (v: unknown, contentType?: unknown) =>
    (typeof contentType === "string" && /keyvaultref/i.test(contentType)) ||
    (typeof v === "string" && SECRET_VALUE.test(v)) ||
    (typeof v === "object" && v !== null && SECRET_VALUE.test(JSON.stringify(v)));
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const { key, value, contentType } = item as Record<string, unknown>;
      if (typeof key === "string") out.push({ key, ...(isSecret(value, contentType) ? { secret: true } : {}) });
    }
  } else if (typeof data === "object" && data !== null) {
    const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
      for (const [k, v] of Object.entries(obj)) {
        if (out.length >= MAX_SETTINGS) return;
        const key = prefix ? `${prefix}:${k}` : k;
        const keyVaultRef = typeof v === "object" && v !== null && "uri" in v;
        if (typeof v === "object" && v !== null && !Array.isArray(v) && !keyVaultRef && depth < 8)
          walk(v as Record<string, unknown>, key, depth + 1);
        else out.push({ key, ...(isSecret(v) ? { secret: true } : {}) });
      }
    };
    walk(data as Record<string, unknown>, "", 0);
  }
  return sanitizeSettings(out) ?? [];
}

/** The textarea form: one key per line, `!` before a secret. Round-trips through parseSettings. */
export const settingsText = (settings: readonly ConfigSetting[]) =>
  settings.map((s) => `${s.secret ? "!" : ""}${s.key}`).join("\n");

/** "4 settings · 2 secret", "1 setting", or undefined when there are none. */
export function settingsSummary(settings: readonly ConfigSetting[]): string | undefined {
  if (!settings.length) return undefined;
  const secret = settings.filter((s) => s.secret).length;
  const n = settings.length;
  return `${n} setting${n === 1 ? "" : "s"}${secret ? ` · ${secret} secret` : ""}`;
}

type EdgeLike = Pick<DiagramEdge, "from" | "to"> & { relation?: unknown; props?: Record<string, unknown> };

/**
 * Settings that entries of config store `storeId` resolve from a secret store: the locked keys of
 * every config edge into it (each key counted once).
 */
export function referencedSettings(edges: readonly EdgeLike[], storeId: string): ConfigSetting[] {
  const out = new Map<string, ConfigSetting>();
  for (const e of edges)
    if (e.to === storeId && relationOf(e) === "config")
      for (const s of edgeSettings(e)) if (s.secret && !out.has(s.key)) out.set(s.key, s);
  return [...out.values()];
}

/**
 * Text drawn on a dependency edge when the user hasn't labelled it: a config edge's settings summary
 * ("4 settings · 2 secret"), or "2 references" on a secret edge out of a config store whose readers
 * mark some keys secret. Undefined otherwise: dependencies have no default text (the glyph says it).
 */
export function derivedLabel(edge: EdgeLike, edges: readonly EdgeLike[]): string | undefined {
  const relation = relationOf(edge);
  if (relation === "config") return settingsSummary(edgeSettings(edge));
  if (relation === "secret") {
    const n = referencedSettings(edges, edge.from).length;
    if (n) return `${n} reference${n === 1 ? "" : "s"}`;
  }
  return undefined;
}

/** The settings a hover card lists for an edge: its own (config) or the references it carries (secret). */
export function edgeSettingsList(edge: EdgeLike, edges: readonly EdgeLike[]): ConfigSetting[] {
  const relation = relationOf(edge);
  if (relation === "config") return edgeSettings(edge);
  if (relation === "secret") return referencedSettings(edges, edge.from);
  return [];
}
