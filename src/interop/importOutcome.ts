import { validateDiagram } from "./native";
import type { DiagramFile } from "../model/types";
import type { FormatId, ImportOutcome } from "./formats";

/** Converter output goes through the native validator too: one set of rules for everything stored. */
export function validated(format: FormatId, diagram: DiagramFile, warnings: string[]): ImportOutcome {
  const r = validateDiagram(diagram);
  return r.ok
    ? { ok: true, format, diagram: r.diagram, warnings: [...warnings, ...r.warnings] }
    : { ok: false, error: r.error };
}
