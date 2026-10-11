import type { ReactNode } from "react";
import type { DiagramFile } from "../model/types";
import type { NodeSimProps, NodeStatus, SimSnapshot } from "../sim/types";

/** Groups shown in the Lab sidebar, in this order. */
export const PRESET_GROUPS = ["Nodes", "Edges", "Diagrams", "Simulation", "Playground"] as const;
export type PresetGroup = (typeof PRESET_GROUPS)[number];

export type ControlValue = string | number | boolean;
export type ControlValues = Record<string, ControlValue>;

interface ControlBase {
  /** URL / values key. Keep it short and lowercase: it ends up in links (`&nodes=150`). */
  key: string;
  label: string;
  hint?: string;
}
export type ControlDef =
  | (ControlBase & { type: "number"; default: number; min?: number; max?: number; step?: number })
  | (ControlBase & { type: "boolean"; default: boolean })
  | (ControlBase & { type: "select"; default: string; options: readonly { value: string; label: string }[] })
  | (ControlBase & { type: "text"; default: string; placeholder?: string });

/** One timed action applied to the engine while a scenario runs. `at` is simulation time in ms. */
export type SimAction =
  | { at: number; do: "inject"; node: string; count: number; type?: string; spreadMs?: number }
  | { at: number; do: "status"; node: string; status: NodeStatus }
  | { at: number; do: "props"; node: string; props: NodeSimProps }
  | { at: number; do: "traffic"; on: boolean };

/** An expectation evaluated once, the first time simulation time reaches `at`. */
export interface SimCheck {
  at: number;
  label: string;
  pass: (snap: SimSnapshot) => boolean;
}

export interface Scenario {
  script: SimAction[];
  checks: SimCheck[];
  /** Sim time (ms) the scenario is "done" at; fast-forward stops here. Default: last action / check + 2s. */
  duration?: number;
}

interface PresetBase {
  /** Stable, URL-safe id (`?preset=<id>`). */
  id: string;
  title: string;
  group: PresetGroup;
  description?: string;
  /** Preset-specific controls. Theme / node variant / edge style are always available on top. */
  controls?: readonly ControlDef[];
}

/** Arbitrary React content: node bodies, component states... */
export interface RenderPreset extends PresetBase {
  kind: "render";
  render: (values: ControlValues) => ReactNode;
}

/** A diagram rendered on the real canvas node / edge components. */
export interface DiagramPreset extends PresetBase {
  kind: "diagram";
  diagram: (values: ControlValues) => DiagramFile;
  /** When the diagram is a shipped example, "Open in editor" links straight to it. */
  exampleSlug?: string;
}

/** A diagram plus a scripted simulation run with live readout and checks. */
export interface ScenarioPreset extends PresetBase {
  kind: "scenario";
  diagram: (values: ControlValues) => DiagramFile;
  scenario: (values: ControlValues) => Scenario;
}

export type Preset = RenderPreset | DiagramPreset | ScenarioPreset;
