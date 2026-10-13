import type { DiagramFile } from "../../model/types";
import { LIMITS, tooLargeMessage, validateDiagram } from "../../interop/native";
import { PAYLOAD_VERSION, type ViewerOptions } from "../inject";
import { UnlockError, unlockPayloadText } from "../lock";

// The exported file's payload: the `#diagram` data block that src/export/inject.ts filled. Read once, and
// checked like every other way a diagram comes in (validateDiagram): the file may have been edited by hand.
// A password-protected file's block is locked (src/export/lock.ts): the viewer asks for the password, and
// unlockPayload decrypts it into the same payload, checked the same way.

/** A password-protected file, before its password: the encrypted payload and the theme to paint the prompt in. */
export interface LockedFile {
  token: string;
  theme: "light" | "dark";
}

export type ViewerPayload =
  | {
      ok: true;
      diagram: DiagramFile;
      icons: Record<string, string>;
      options: ViewerOptions;
      error?: undefined;
      locked?: undefined;
    }
  | { ok: false; error: string; locked?: undefined }
  | { ok: false; error?: undefined; locked: LockedFile };

export type OpenPayload = Extract<ViewerPayload, { ok: true }>;

let cached: ViewerPayload | undefined;

/** Budgets for a file that may have been edited by hand: checked before anything is parsed or kept. */
export const PAYLOAD_LIMITS = {
  /** The diagram, as the app's own files are capped (LIMITS.maxTextChars). */
  diagramChars: LIMITS.maxTextChars,
  icons: 400,
  /** One icon's data URI; the catalog's largest is a few kB. */
  iconChars: 200_000,
  /** Everything: the diagram, its icons (a few kB each; 4 MB is far beyond any real diagram) and the options. */
  totalChars: LIMITS.maxTextChars + 4_000_000,
};

const DAMAGED = "This file's diagram is damaged. Export it again from Live Diagrams.";

/** The payload's text checked and parsed (exported for the unit test). */
export function parsePayload(source: string | null | undefined): ViewerPayload {
  if (source && source.length > PAYLOAD_LIMITS.totalChars) return { ok: false, error: tooLargeMessage(source.length) };
  const text = source?.trim();
  if (!text || text.startsWith("__"))
    return { ok: false, error: "This file has no diagram in it. Export it again from Live Diagrams." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: DAMAGED };
  }
  const p = raw as Partial<{
    version: unknown;
    diagram: unknown;
    icons: unknown;
    options: Partial<ViewerOptions>;
    encrypted: unknown;
    theme: unknown;
  }>;
  if (p?.version !== PAYLOAD_VERSION)
    return { ok: false, error: "This file comes from a newer version of Live Diagrams and can't be shown here." };
  // Password-protected: nothing to check until it's unlocked (the token's own format is checked then).
  if (p.encrypted !== undefined)
    return typeof p.encrypted === "string" && p.encrypted
      ? { ok: false, locked: { token: p.encrypted, theme: p.theme === "dark" ? "dark" : "light" } }
      : { ok: false, error: DAMAGED };
  const diagramChars = JSON.stringify(p.diagram ?? null).length;
  if (diagramChars > PAYLOAD_LIMITS.diagramChars) return { ok: false, error: tooLargeMessage(diagramChars) };
  const result = validateDiagram(p.diagram);
  if (!result.ok) return { ok: false, error: result.error };
  const icons: Record<string, string> = {};
  if (p.icons && typeof p.icons === "object")
    for (const [name, uri] of Object.entries(p.icons).slice(0, PAYLOAD_LIMITS.icons))
      // Only data: images, and not huge ones: an icon must never make the page fetch anything.
      if (typeof uri === "string" && uri.startsWith("data:image/") && uri.length <= PAYLOAD_LIMITS.iconChars)
        icons[name] = uri;
  const o = p.options ?? {};
  const sims = result.diagram.simulations ?? [];
  return {
    ok: true,
    diagram: result.diagram,
    icons,
    options: {
      theme: o.theme === "dark" ? "dark" : "light",
      banner: typeof o.banner === "string" && o.banner.trim() ? o.banner.trim().slice(0, 300) : undefined,
      startSimulation:
        typeof o.startSimulation === "string" && sims.some((s) => s.id === o.startSimulation)
          ? o.startSimulation
          : null,
      exportedOn: typeof o.exportedOn === "string" ? o.exportedOn.slice(0, 32) : "",
    },
  };
}

export function readPayload(): ViewerPayload {
  return (cached ??= parsePayload(document.getElementById("diagram")?.textContent));
}

/**
 * A password-protected file's payload, decrypted with `password` and checked like any other (it then becomes what
 * readPayload returns). Throws an UnlockError (src/export/lock.ts): `wrong` for a wrong password.
 */
export async function unlockPayload(locked: LockedFile, password: string): Promise<OpenPayload> {
  // UTF-8 takes at most 3 bytes per character the payload may have.
  const text = await unlockPayloadText(locked.token, password, PAYLOAD_LIMITS.totalChars * 3);
  const payload = parsePayload(text);
  if (!payload.ok) throw new UnlockError(payload.error ?? DAMAGED);
  cached = payload;
  return payload;
}
