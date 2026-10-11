// Opening the AI panel from anywhere (the rail, Ctrl+I, a right-click, the palette) without importing
// it: it's lazy-loaded by AiMount. Keep this file tiny: it's in the main bundle.

import { formatCombo } from "../../editor/shortcuts";

export const OPEN_AI_PANEL = "diagrams:open-ai";

/** Shows the AI panel and focuses it, everywhere a diagram is open (AiMount handles it). */
export const AI_PANEL_COMBO = "Mod+I";
export const aiPanelTitle = () => `AI panel (${formatCombo(AI_PANEL_COMBO)})`;

export interface OpenAiPanel {
  /** Open the panel's Advanced copy-and-paste flow, ready to describe (Build with AI). */
  advanced?: boolean;
}

/** Opens (or focuses) the AI panel. */
export function openAiPanel(detail: OpenAiPanel = {}): void {
  window.dispatchEvent(new CustomEvent<OpenAiPanel>(OPEN_AI_PANEL, { detail }));
}

/** "Build with AI…" (Ctrl+K): a new, blank diagram and Advanced ready to describe it. */
export function buildWithAi(onNewDiagram: () => void): void {
  onNewDiagram();
  openAiPanel({ advanced: true });
}
