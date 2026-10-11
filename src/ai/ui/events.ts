// Opening "Build with AI" from anywhere (the File menu, the palette, the canvas right-click) without
// importing the dialog: it's lazy-loaded by AiMount. Keep this file tiny: it's in the main bundle.

export const OPEN_AI_DIALOG = "diagrams:open-ai";

export function openAiDialog(): void {
  window.dispatchEvent(new Event(OPEN_AI_DIALOG));
}
