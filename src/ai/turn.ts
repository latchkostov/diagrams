// What one AI turn does to the diagram, whoever produced it: a pasted reply (Advanced), or an agent's
// successful tool calls, recorded in order. The same steps plan (src/ai/ui/apply.ts planSteps) and
// commit the same way, so both paths make identical turns.

import type { DiagramOp, LayoutMode, SimulationSpec } from "./index";

export type TurnStep =
  | { kind: "ops"; ops: DiagramOp[]; layout?: LayoutMode }
  | { kind: "simulation"; spec: SimulationSpec }
  | { kind: "file"; file: Record<string, unknown> };
