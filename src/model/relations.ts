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
    if (looksLikeCredential(key)) continue;
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

export const MAX_SETTINGS_TEXT = 1_000_000;
export const MAX_SETTINGS_DEPTH = 16;

/** Credential-shaped text is never a setting name, including names supplied by JSON imports. */
function looksLikeCredential(key: string): boolean {
  return (
    /(?:^|[;:])\s*(?:Server|Data Source|AccountKey|SharedAccessKey|Password|User Id)\s*=[^;]+(?:;|$)/i.test(key) ||
    /(?:^|[:/])(?:Bearer\s+|eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:sk|ghp|github_pat|AKIA)[_-]?[\w-]{16,})/i.test(key.trim()) ||
    (/^[A-Za-z0-9+/_=-]{40,}$/.test(key.trim()) && /[A-Z]/.test(key) && /[a-z]/.test(key) && /\d/.test(key)) ||
    /:\/\/[^\s/]+:[^\s/]+@/.test(key)
  );
}

/** Bound before parsing. Braces inside strings do not count as nesting. */
function checkSettingsInput(text: string): void {
  if (text.length > MAX_SETTINGS_TEXT) throw new Error("Settings paste is too large (maximum 1,000,000 characters).");
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      if (++depth > MAX_SETTINGS_DEPTH) throw new Error("Settings paste exceeds the nesting limit (16 levels).");
    } else if (c === "}" || c === "]") depth--;
  }
}

/** Detect references without serializing values. Input is depth bounded. */
function secretValue(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const v = pending.pop();
    if (typeof v === "string" && SECRET_VALUE.test(v)) return true;
    if (v && typeof v === "object") {
      if ("uri" in v) return true;
      for (const item of Object.values(v)) pending.push(item);
    }
  }
  return false;
}

/** Paste import only: discard values from appsettings, .env, CLI JSON and key/value lines. */
export function parseSettings(text: string): ConfigSetting[] {
  checkSettingsInput(text);
  const t = text.trim();
  if (/^[[{]/.test(t) && !t.startsWith("[lock]")) return parseJsonSettings(t);
  const out: ConfigSetting[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/,$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    let secret = false;
    const marker = /^(!|🔒|\[lock\])\s*/u.exec(line);
    if (marker) {
      secret = true;
      line = line.slice(marker[0].length);
    }
    line = line.replace(/^export\s+/, "");
    // Recognize the name=connection-string case before rejecting standalone credential values.
    if (
      /^(?:Server|Data Source|DefaultEndpointsProtocol|AccountName|Host)\s*=.*;/i.test(line) ||
      (!/^[\w:/.-]+=/.test(line) && looksLikeCredential(line))
    )
      continue;
    let key = line,
      value = "";
    const json = /^"((?:[^"\\]|\\.)*)"\s*:\s*(.*)$/.exec(line);
    if (json) {
      try {
        key = JSON.parse(`"${json[1]}"`) as string;
      } catch {
        throw new Error("Invalid JSON setting name.");
      }
      value = json[2];
    } else {
      const eq = line.indexOf("=");
      const sp = /\s/.exec(line);
      if (eq > 0) {
        key = line.slice(0, eq);
        value = line.slice(eq + 1);
      } else if (sp) {
        key = line.slice(0, sp.index);
        value = line.slice(sp.index);
      }
      key = key.trim().replace(/^["'`]|["'`]$/g, "");
    }
    if (SECRET_VALUE.test(value) || /^\/aws\/reference\/secretsmanager\//i.test(key)) secret = true;
    out.push(secret ? { key, secret: true } : { key });
    if (out.length >= MAX_SETTINGS) break;
  }
  return sanitizeSettings(out) ?? [];
}

/** Structured input never falls back to lines, even when malformed or rejected. */
function parseJsonSettings(text: string): ConfigSetting[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON settings paste. Paste a complete document.");
  }
  const out: ConfigSetting[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const { key, value, contentType } = item as Record<string, unknown>;
      if (typeof key === "string")
        out.push({
          key,
          ...(secretValue(value) || (typeof contentType === "string" && /keyvaultref/i.test(contentType))
            ? { secret: true }
            : {}),
        });
      if (out.length >= MAX_SETTINGS) break;
    }
  } else if (data && typeof data === "object") {
    const walk = (obj: Record<string, unknown>, prefix: string) => {
      for (const [k, v] of Object.entries(obj)) {
        if (out.length >= MAX_SETTINGS) return;
        const key = prefix ? `${prefix}:${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v) && !("uri" in v)) walk(v as Record<string, unknown>, key);
        else out.push({ key, ...(secretValue(v) ? { secret: true } : {}) });
      }
    };
    walk(data as Record<string, unknown>, "");
  }
  return sanitizeSettings(out) ?? [];
}

/** Lossless literal editor codec: leading ! and JSON-quoted names are the only syntax. */
export function parseSettingsEditor(text: string): ConfigSetting[] {
  if (text.length > MAX_SETTINGS_TEXT) return [];
  const out: ConfigSetting[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const secret = raw.startsWith("!");
    let key = (secret ? raw.slice(1) : raw).trim();
    if (key.startsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(key);
        if (typeof decoded !== "string") continue;
        key = decoded;
      } catch {
        continue;
      } // Incomplete quoted names are still being edited.
    }
    out.push(secret ? { key, secret: true } : { key });
  }
  return sanitizeSettings(out) ?? [];
}

export const settingsText = (settings: readonly ConfigSetting[]) =>
  settings.map((s) => `${s.secret ? "!" : ""}${/^[\w:/*.-]+$/.test(s.key) ? s.key : JSON.stringify(s.key)}`).join("\n");

/** Shared semantics for playback and edit-capacity cache invalidation. */
export const edgeSemanticSignature = (e: Pick<DiagramEdge, "id" | "from" | "to" | "kind" | "relation" | "props">) => [
  e.id,
  e.from,
  e.to,
  e.kind ?? "async",
  relationOf(e),
  e.props ?? null,
];

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

export interface EdgeRelationInfo {
  relation: DependencyRelation;
  text?: string;
  derived: boolean;
  settings: ConfigSetting[];
}

/** Sanitize each config once, then aggregate references once per store, shared by labels and cards. */
export function deriveRelationInfo(
  edges: readonly (EdgeLike & { id: string; label?: string })[],
): Map<string, EdgeRelationInfo> {
  const settingsByEdge = new Map<string, ConfigSetting[]>();
  const refs = new Map<string, Map<string, ConfigSetting>>();
  for (const e of edges) {
    if (relationOf(e) !== "config") continue;
    const settings = edgeSettings(e);
    settingsByEdge.set(e.id, settings);
    let store = refs.get(e.to);
    if (!store) {
      store = new Map();
      refs.set(e.to, store);
    }
    for (const setting of settings) if (setting.secret && !store.has(setting.key)) store.set(setting.key, setting);
  }
  const referencedSettingsByStore = new Map([...refs].map(([id, settings]) => [id, [...settings.values()]]));
  const result = new Map<string, EdgeRelationInfo>();
  const empty: ConfigSetting[] = [];
  for (const e of edges) {
    const relation = relationOf(e);
    if (relation === "flow") continue;
    const settings =
      relation === "config"
        ? (settingsByEdge.get(e.id) ?? empty)
        : relation === "secret"
          ? (referencedSettingsByStore.get(e.from) ?? empty)
          : empty;
    const label = e.label?.trim();
    const derived =
      relation === "config"
        ? settingsSummary(settings)
        : relation === "secret" && settings.length
          ? `${settings.length} reference${settings.length === 1 ? "" : "s"}`
          : undefined;
    result.set(e.id, { relation, text: label || derived, derived: !label && !!derived, settings });
  }
  return result;
}
