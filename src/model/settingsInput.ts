// Editing and importing settings text is optional; saved settings validation stays eager.
import type { ConfigSetting } from "./relations";
import { MAX_SETTINGS, sanitizeSettings, looksLikeCredential } from "./relations";

/** A value that points at a secret store rather than holding the value itself. */
const SECRET_VALUE =
  /@Microsoft\.KeyVault|vault\.azure\.net|application\/vnd\.microsoft\.appconfig\.keyvaultref|\/aws\/reference\/secretsmanager\/|secretsmanager:|"uri"\s*:/i;

export const MAX_SETTINGS_TEXT = 1_000_000;
export const MAX_SETTINGS_DEPTH = 16;

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
