// Opening "Ask AI" from anywhere (the top bar, the rail, the File menu, the palette, a right-click)
// without importing the panel: it's lazy-loaded by AiMount. Keep this file tiny: it's in the main bundle.

import { formatCombo } from "../../editor/shortcuts";

export const OPEN_AI_PANEL = "diagrams:open-ai";

/** Shows the Ask AI dock and focuses it, everywhere a diagram is open (AiMount handles it). */
export const ASK_AI_COMBO = "Mod+I";
export const askAiTitle = () => `Ask AI (${formatCombo(ASK_AI_COMBO)})`;

export interface OpenAiPanel {
  /** Ids the request is about (Change with AI… on a node, edge or selection). Replaces the current scope. */
  scope?: string[];
  /** Start the composer in this intent (Explain this diagram). */
  intent?: "change" | "explain";
}

/** Opens (or focuses) the Ask AI panel. */
export function openAiPanel(detail: OpenAiPanel = {}): void {
  window.dispatchEvent(new CustomEvent<OpenAiPanel>(OPEN_AI_PANEL, { detail }));
}

/** "Build with AI…": a new, blank diagram and the panel ready to describe it. */
export function buildWithAi(onNewDiagram: () => void): void {
  onNewDiagram();
  openAiPanel({ intent: "change" });
}
