import type { DiagramFile } from "../model/types";
import { matchesLocalExample } from "./localOnly.dev";
import { AI_TOOLS, ON_DEVICE, SHARE_LINKS } from "./deployment";

// The one privacy decision. A diagram is kept on this device (no AI, no share links, no cloud saves) when
// it is either:
//   - "local-only": a built-in private example (development only), a copy of one, or content matching one;
//   - "private": the person marked it Private (or it came from a private diagram: a copy, an import of a
//     private file, a paste of its nodes).
// Every gate (the page's AI tools, Copy for AI, prompts, the on-device model, share links, embeds, cloud
// storage) asks the functions below, never the flags directly. The gates also ask how this copy is deployed
// (./deployment.ts): a self-hosted copy can turn links and AI off for every diagram.

export interface CanvasPrivacyState {
  /** Built-in provenance: a local-only example or a copy of one. Sticky; there's no switch for it. */
  localOnly?: boolean;
  /** The person's Private switch (or inherited from a private source). */
  private?: boolean;
  /** This private diagram may use the on-device model (stays on this device). Ignored unless private. */
  onDevice?: boolean;
  diagram?: DiagramFile;
  editor?: { getDiagram(): DiagramFile };
}

export type Privacy = "local-only" | "private" | null;

/** Provenance wins; in development, content matching a local-only example catches imports and pasted copies. */
export function privacyOf(state: CanvasPrivacyState | null | undefined): Privacy {
  if (state?.localOnly) return "local-only";
  if (import.meta.env.DEV && state) {
    const diagram = state.diagram ?? state.editor?.getDiagram();
    if (diagram && matchesLocalExample(diagram)) return "local-only";
  }
  return state?.private ? "private" : null;
}

/** Shared AI boundary: true for any diagram that stays on this device (local-only or Private). */
export function isLocalOnly(state: CanvasPrivacyState | null | undefined): boolean {
  return privacyOf(state) !== null;
}

/**
 * Share links (`#d=`, password-protected or not) and embed codes. The single gate for every link: none in a
 * copy deployed without them, and none for a diagram that stays on this device.
 */
export function canShareAsLink(state: CanvasPrivacyState | null | undefined): boolean {
  return SHARE_LINKS && !isLocalOnly(state);
}

/**
 * AI that reads the diagram outside the app: the page's tools for agents (WebMCP), Copy for AI and copied
 * prompts. None in a copy deployed without them, and none for a diagram that stays on this device.
 */
export function canUseAiTools(state: CanvasPrivacyState | null | undefined): boolean {
  return AI_TOOLS && !isLocalOnly(state);
}

/** Saving to Google Drive, OneDrive or Dropbox. Files on this device are always allowed (the person's own act). */
export function canSaveToCloud(state: CanvasPrivacyState | null | undefined): boolean {
  return !isLocalOnly(state);
}

/**
 * Chrome's built-in model runs on this device, so a Private diagram may use it once the person allows it
 * for that diagram. A local-only one never does, and nothing does in a copy deployed without it.
 */
export function canUseOnDevice(state: CanvasPrivacyState | null | undefined): boolean {
  return ON_DEVICE && aiMayChange(state);
}

/**
 * The AI panel's history for this diagram: Undo this change, Revert to here and a turn's stencil choices. They
 * act on turns already made (by an agent, a pasted reply or the on-device model), so they follow the diagram's
 * privacy, not which models this copy offers: a copy without the on-device model keeps them for agents' turns.
 */
export function canUseAiHistory(state: CanvasPrivacyState | null | undefined): boolean {
  return aiMayChange(state);
}

/** Any diagram that isn't kept on this device; a Private one only once it allows the on-device model. */
function aiMayChange(state: CanvasPrivacyState | null | undefined): boolean {
  const privacy = privacyOf(state);
  return privacy === null || (privacy === "private" && !!state?.onDevice);
}

export const PRIVATE_SHARE_MESSAGE = "Private diagrams can't be shared as links. Export a file instead.";
export const PRIVATE_AI_OFF = "AI is off for this private diagram";
