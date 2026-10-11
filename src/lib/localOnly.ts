import type { DiagramFile } from "../model/types";
import { matchesLocalExample } from "./localOnly.dev";

interface CanvasPrivacyState {
  localOnly?: boolean;
  diagram?: DiagramFile;
  editor?: { getDiagram(): DiagramFile };
}

/** Shared AI boundary: provenance wins; dev content matching catches imports and pasted copies. */
export function isLocalOnly(canvasState: CanvasPrivacyState | null | undefined): boolean {
  if (canvasState?.localOnly) return true;
  if (import.meta.env.DEV && canvasState) {
    const diagram = canvasState.diagram ?? canvasState.editor?.getDiagram();
    return !!diagram && matchesLocalExample(diagram);
  }
  return false;
}
