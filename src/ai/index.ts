// Pure TypeScript contract shared by the editor, tool adapters and Node consumers.
import type { DiagramFile, DiagramGroup, EdgeRelation, MetricField } from "../model/types";
import type { RelationChange } from "../stencils/relations";

export type Ref = string;
export type LayoutMode = "auto" | "full" | "none";
export type NodeProps = Record<string, unknown>;
export type DiagramOp =
  | { op: "add_node"; kind: string; label: string; sublabel?: string; key?: string; in?: Ref; props?: NodeProps }
  | {
      op: "connect";
      from: Ref;
      to: Ref;
      label?: string;
      kind?: "async" | "sync";
      /** Absent: infer from the stencils, as in the editor. An explicit flow carries traffic. */
      relation?: EdgeRelation;
      key?: string;
    }
  | {
      op: "update";
      target: Ref;
      label?: string;
      sublabel?: string | null;
      kind?: string;
      in?: Ref | null;
      props?: NodeProps;
      members?: Ref[];
      tone?: DiagramGroup["tone"];
    }
  | { op: "remove"; targets: Ref[] }
  | { op: "insert_between"; from: Ref; to: Ref; kind: string; label: string; sublabel?: string; key?: string }
  | { op: "add_boundary"; label: string; members: Ref[]; tone?: DiagramGroup["tone"]; key?: string }
  | { op: "add_note"; text: string; style?: "note" | "text"; near?: Ref; key?: string }
  | {
      op: "set_meta";
      title?: string;
      description?: string;
      direction?: "LR" | "TB";
      /** Request routing: the diagram's complete request routes (a replacement, validated against the whole batch). */
      requestRoutes?: import("../model/requestRouting").RequestRoute[];
    };
export interface ApplyOpsOptions {
  layout?: LayoutMode;
  dryRun?: boolean;
}
export interface Candidate {
  id: string;
  label: string;
  stencil?: string;
}
export interface AiError {
  ref?: string;
  i: number;
  error: string;
  candidates?: Candidate[];
  hint?: string;
}
export interface StencilResolution {
  id: string;
  label: string;
  confidence: "high" | "medium" | "low";
  alternatives: string[];
}
export interface OpResult {
  i: number;
  op: DiagramOp["op"];
  id?: string;
  ids?: string[];
  label?: string;
  from?: string;
  to?: string;
  stencil?: StencilResolution;
  /** A node's new stencil re-inferred these connections' relationships (an `update` with `kind`). */
  relations?: RelationChange[];
  /** Re-inferred connections left out of `relations` (it lists at most 50 per op, 200 per batch). */
  relationsOmitted?: number;
  /** What changed besides the op itself, in a sentence ("1 connection is now Config: no messages flow over it"). */
  note?: string;
}
export interface ApplyOpsResult {
  ok: boolean;
  diagram: DiagramFile;
  results: OpResult[];
  errors: AiError[];
  warnings: string[];
  summary: string;
  dryRun?: boolean;
}
export interface DescribeOptions {
  format?: "text" | "json";
  focus?: Ref[];
  limit?: number;
}
export interface SimulationSpec {
  title: string;
  /** The agent's note for the person (shown in the AI panel); not part of the simulation. */
  summary?: string;
  replace?: Ref;
  durationSec?: number;
  traffic: {
    from: Ref;
    pattern: "constant" | "burst" | "ramp" | "spike";
    ratePerSec?: number;
    toRatePerSec?: number;
    count?: number;
    startSec?: number;
    durationSec?: number;
    peakSec?: number;
    messageType?: string;
    label?: string;
  }[];
  events?: {
    atSec: number;
    node: Ref;
    do: "down" | "up" | "pause" | "slow" | "set";
    latencyMs?: number;
    props?: NodeProps;
    note?: string;
  }[];
  expectations?: {
    label: string;
    node?: Ref;
    metric: MetricField | "inSystem";
    op: "<" | "<=" | "==" | ">=" | ">";
    value: number;
    when?: "always" | "eventually" | "end";
  }[];
}

export { applyOps } from "./ops";
export { describeDiagram } from "./describe";
export { buildSimulation } from "./simulate";
export { resolveKind, findStencils } from "./stencils";
export { resolveRef, ReferenceError } from "./refs";
export { placeNew, fitGroupToContents, fitGroups } from "./place";
export * from "./schemas";
