// The host-supplied embed's state machine: one checked message in, the next state and what to do out. Pure,
// so every rule (what a load replaces, what needs a diagram first, which ids exist) is unit-tested
// (hostReducer.test.ts); HostEmbedView.tsx applies the effects.

import type { DiagramFile } from "../../model/types";
import { validateDiagram } from "../native";
import {
  diagramText,
  MAX_DIAGRAM_CHARS,
  type EmbedTheme,
  type FrameMessage,
  type HostMessage,
  type LoadOptions,
  type Speed,
} from "./hostProtocol";

export interface HostState {
  /** The diagram on screen (marked private: it never gets a link), or null before the first good load. */
  diagram: DiagramFile | null;
  /** Bumps with every good load: the canvas remounts, fitted, with the new diagram and options. */
  generation: number;
  /** The last good load's options, defaults filled in. */
  options: Required<Omit<LoadOptions, "theme" | "simulation" | "speed">> & {
    theme: EmbedTheme | null;
    simulation: string | null;
    speed: Speed | null;
  };
  highlight: string[];
  /** Why there's nothing to show yet (a load failed before any succeeded). */
  error: string | null;
}

export type LiveOp =
  { kind: "play" } | { kind: "pause" } | { kind: "speed"; speed: Speed } | { kind: "simulation"; id: string | null };

export type Effect =
  | { kind: "post"; message: FrameMessage }
  | { kind: "theme"; theme: EmbedTheme }
  | { kind: "live"; op: LiveOp }
  | { kind: "fit" };

export const initialHostState: HostState = {
  diagram: null,
  generation: 0,
  options: { theme: null, simulation: null, autoplay: false, speed: null, fit: true },
  highlight: [],
  error: null,
};

const MB = (n: number) => `${(n / 1_000_000).toFixed(0)} MB`;

type Result = { state: HostState; effects: Effect[] };

const error = (
  state: HostState,
  id: string | undefined,
  code: Extract<FrameMessage, { type: "error" }>["code"],
  message: string,
): Result => ({
  state,
  effects: [{ kind: "post", message: { type: "error", ...(id === undefined ? {} : { id }), code, message } }],
});

/** Validates a load's diagram: size first (before any parsing), then the same validator as every file. */
export function loadDiagram(
  diagram: unknown,
): { ok: true; diagram: DiagramFile } | { ok: false; tooLarge: boolean; message: string } {
  const text = diagramText(diagram);
  if (!text.ok)
    return text.tooLarge
      ? {
          ok: false,
          tooLarge: true,
          message: `The diagram is too large (the limit is ${MB(MAX_DIAGRAM_CHARS)} of JSON).`,
        }
      : { ok: false, tooLarge: false, message: "The diagram couldn't be read as JSON." };
  let data: unknown;
  try {
    data = JSON.parse(text.text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, tooLarge: false, message: "The diagram isn't valid JSON." };
  }
  const result = validateDiagram(data);
  if (!result.ok) return { ok: false, tooLarge: false, message: result.error };
  // Treated as a private diagram everywhere: no share link, no embed code, no AI.
  return { ok: true, diagram: { ...result.diagram, private: true } };
}

export function hostReducer(state: HostState, msg: HostMessage): Result {
  const id = msg.id;
  if (msg.type === "load") {
    const loaded = loadDiagram(msg.diagram);
    if (!loaded.ok) {
      const next = state.diagram ? state : { ...state, error: loaded.message };
      return error(next, id, loaded.tooLarge ? "too_large" : "invalid_diagram", loaded.message);
    }
    const d = loaded.diagram;
    const o = msg.options;
    const sims = d.simulations ?? [];
    if (o.simulation && !sims.some((s) => s.id === o.simulation))
      return error(
        state.diagram ? state : { ...state, error: `There's no simulation “${o.simulation}” in this diagram.` },
        id,
        "unknown_simulation",
        `There's no simulation “${o.simulation}” in this diagram.`,
      );
    const theme = o.theme ?? state.options.theme;
    const next: HostState = {
      diagram: d,
      generation: state.generation + 1,
      options: {
        theme,
        simulation: o.simulation ?? null,
        autoplay: o.autoplay ?? false,
        speed: o.speed ?? null,
        fit: o.fit ?? true,
      },
      highlight: [],
      error: null,
    };
    const effects: Effect[] = [];
    if (o.theme) effects.push({ kind: "theme", theme: o.theme });
    effects.push({
      kind: "post",
      message: {
        type: "loaded",
        ...(id === undefined ? {} : { id }),
        title: d.title,
        nodes: d.nodes.length,
        simulations: sims.map((s) => ({ id: s.id, title: s.title })),
      },
    });
    return { state: next, effects };
  }
  if (msg.type === "setTheme")
    return {
      state: { ...state, options: { ...state.options, theme: msg.theme } },
      effects: [{ kind: "theme", theme: msg.theme }],
    };
  // Everything else acts on a diagram.
  const d = state.diagram;
  if (!d) return error(state, id, "not_loaded", `${msg.type}: there's no diagram yet. Send load first.`);
  switch (msg.type) {
    case "play":
      return { state, effects: [{ kind: "live", op: { kind: "play" } }] };
    case "pause":
      return { state, effects: [{ kind: "live", op: { kind: "pause" } }] };
    case "setSpeed":
      return { state, effects: [{ kind: "live", op: { kind: "speed", speed: msg.speed } }] };
    case "selectSimulation":
      if (msg.simulation !== null && !(d.simulations ?? []).some((s) => s.id === msg.simulation))
        return error(state, id, "unknown_simulation", `There's no simulation “${msg.simulation}” in this diagram.`);
      return { state, effects: [{ kind: "live", op: { kind: "simulation", id: msg.simulation } }] };
    case "fit":
      return { state, effects: [{ kind: "fit" }] };
    case "highlight": {
      // Ids that aren't nodes of this diagram are left out (a stale list after a load highlights what's left).
      const known = new Set(d.nodes.map((n) => n.id));
      return { state: { ...state, highlight: msg.nodeIds.filter((n) => known.has(n)) }, effects: [] };
    }
  }
}
