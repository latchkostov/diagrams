import type { JsonSchema } from "./jsonSchema";

/** Runtime overlays: clearing a fault reveals the current configuration, without overwriting it. */
export type Fault =
  | { kind: "boundary"; boundary: string; down: boolean }
  | { kind: "slow"; node: string; factor: 1 | 2 | 5 | 10 }
  | { kind: "fail"; node: string; rate: 0 | 0.1 | 0.5 }
  | { kind: "purge"; node: string; rule?: string; mode?: "hard" | "soft"; reason?: "purge" | "deploy" }
  | { kind: "link"; edge: string; cut: boolean };

export const DRILL_PRESETS = [
  "zone-outage",
  "region-connectivity",
  "slow-dependency",
  "error-spike",
  "cold-cache",
] as const;
export type DrillPreset = (typeof DRILL_PRESETS)[number];

export const faultTarget = (fault: Fault): string =>
  fault.kind === "boundary" ? fault.boundary : fault.kind === "link" ? fault.edge : fault.node;
export function faultProblem(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "a fault needs a kind and target";
  const f = value as Record<string, unknown>;
  const fields =
    f.kind === "boundary"
      ? ["kind", "boundary", "down"]
      : f.kind === "link"
        ? ["kind", "edge", "cut"]
        : f.kind === "slow"
          ? ["kind", "node", "factor"]
          : f.kind === "purge"
            ? ["kind", "node", "rule", "mode", "reason"]
            : ["kind", "node", "rate"];
  if (Object.keys(f).some((key) => !fields.includes(key))) return "unexpected fault property";
  const target = f.kind === "boundary" ? f.boundary : f.kind === "link" ? f.edge : f.node;
  if (typeof target !== "string" || !target.length) return "a fault needs a target id";
  if (f.kind === "boundary" && typeof f.down === "boolean") return;
  if (f.kind === "link" && typeof f.cut === "boolean") return;
  if (f.kind === "slow" && [1, 2, 5, 10].includes(f.factor as number)) return;
  if (f.kind === "fail" && [0, 0.1, 0.5].includes(f.rate as number)) return;
  if (
    f.kind === "purge" &&
    (f.rule === undefined || typeof f.rule === "string") &&
    (f.mode === undefined || f.mode === "hard" || f.mode === "soft") &&
    (f.reason === undefined || f.reason === "purge" || f.reason === "deploy")
  )
    return;
  return "invalid fault kind or magnitude";
}

export const faultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "node"],
      additionalProperties: false,
      properties: {
        kind: { const: "purge" },
        node: { type: "string", minLength: 1 },
        rule: { type: "string" },
        mode: { enum: ["hard", "soft"] },
        reason: { enum: ["purge", "deploy"] },
      },
    },
    {
      type: "object",
      required: ["kind", "boundary", "down"],
      additionalProperties: false,
      properties: {
        kind: { const: "boundary" },
        boundary: { type: "string", minLength: 1 },
        down: { type: "boolean" },
      },
    },
    {
      type: "object",
      required: ["kind", "node", "factor"],
      additionalProperties: false,
      properties: { kind: { const: "slow" }, node: { type: "string", minLength: 1 }, factor: { enum: [1, 2, 5, 10] } },
    },
    {
      type: "object",
      required: ["kind", "node", "rate"],
      additionalProperties: false,
      properties: { kind: { const: "fail" }, node: { type: "string", minLength: 1 }, rate: { enum: [0, 0.1, 0.5] } },
    },
    {
      type: "object",
      required: ["kind", "edge", "cut"],
      additionalProperties: false,
      properties: { kind: { const: "link" }, edge: { type: "string", minLength: 1 }, cut: { type: "boolean" } },
    },
  ],
};
