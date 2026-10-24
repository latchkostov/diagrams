/** Pure transitions. Commands describe work; only the caller executes them. */
export interface MachineState {
  value: string;
}
export interface MachineEvent {
  type: string;
}
export interface MachineStep<S, C> {
  state: S;
  commands: readonly C[];
}
export interface Transition<S extends MachineState, E, C> {
  target: S["value"];
  guard?: (state: S, event: E) => boolean;
  reduce?: (state: S, event: E) => S;
  effects?: (state: S, event: E, next: S) => readonly C[];
}
type Rows<S extends MachineState, E extends MachineEvent, C> = {
  [K in E["type"]]?: Transition<S, E & { type: K }, C> | readonly Transition<S, E & { type: K }, C>[];
};
export interface MachineDefinition<S extends MachineState, E extends MachineEvent, C = never> {
  initial: S;
  states: readonly S["value"][];
  on: Partial<Record<S["value"] | "*", Rows<S, E, C>>>;
  /** Representative payloads for executable paths, including both sides of data-dependent guards. */
  events: readonly E[];
}
export interface MachineCause<S, E> {
  seq: number;
  from: S;
  event: E;
  to: S;
  accepted: boolean;
}

export function defineMachine<S extends MachineState, E extends MachineEvent, C = never>(
  definition: MachineDefinition<S, E, C>,
): MachineDefinition<S, E, C> {
  return definition;
}

/** First passing guard wins; a local row overrides the wildcard row. Ignored events are journaled too. */
export function machineStep<S extends MachineState, E extends MachineEvent, C>(
  def: MachineDefinition<S, E, C>,
  state: S,
  event: E,
): MachineStep<S, C> & { accepted: boolean } {
  const row = def.on[state.value as S["value"]]?.[event.type as E["type"]] ?? def.on["*"]?.[event.type as E["type"]];
  // Indexing by the event's discriminant preserves the row/payload relationship at runtime.
  const choices = (Array.isArray(row) ? row : row ? [row] : []) as readonly Transition<S, E, C>[];
  const transition = choices.find((t) => !t.guard || t.guard(state, event));
  if (!transition) return { state, commands: [], accepted: false };
  const next = { ...(transition.reduce?.(state, event) ?? state), value: transition.target };
  return { state: next, commands: transition.effects?.(state, event, next) ?? [], accepted: true };
}

/** A synchronous single writer, with a bounded cause ring. No scheduler, React, or clock. */
export function createMachine<S extends MachineState, E extends MachineEvent, C>(
  def: MachineDefinition<S, E, C>,
  { journalSize = 64 }: { journalSize?: number } = {},
) {
  if (!Number.isInteger(journalSize) || journalSize < 0) throw new Error("Invalid machine journal size");
  let state = def.initial;
  let seq = 0;
  const ring: MachineCause<S, E>[] = [];
  const recording = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
  return {
    get state() {
      return state;
    },
    get journal(): readonly MachineCause<S, E>[] {
      if (!recording) return [];
      return ring.length < journalSize
        ? ring.slice()
        : [...ring.slice(seq % journalSize), ...ring.slice(0, seq % journalSize)];
    },
    send(event: E): MachineStep<S, C> {
      const from = state;
      const result = machineStep(def, state, event);
      state = result.state;
      if (recording && journalSize)
        ring[seq % journalSize] = { seq: seq + 1, from, event, to: state, accepted: result.accepted };
      if (recording) seq++;
      return { state, commands: result.commands };
    },
  };
}

/** All accepted paths through representative events, not just graph edges: guards and reducers run. */
export function machinePaths<S extends MachineState, E extends MachineEvent, C>(
  def: MachineDefinition<S, E, C>,
  { maxDepth }: { maxDepth: number },
): { state: S; events: readonly E[] }[] {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("Invalid machine path depth");
  const paths: { state: S; events: readonly E[] }[] = [{ state: def.initial, events: [] }];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (path.events.length === maxDepth) continue;
    for (const event of def.events) {
      const next = machineStep(def, path.state, event);
      if (next.accepted) paths.push({ state: next.state, events: [...path.events, event] });
    }
  }
  return paths;
}

/** Dev documentation only; Vite eliminates the body and its call sites in production. */
export function describeMachine<S extends MachineState, E extends MachineEvent, C>(
  def: MachineDefinition<S, E, C>,
): string {
  if (!import.meta.env.DEV) return "";
  const lines = ["stateDiagram-v2", `  [*] --> ${def.initial.value}`];
  for (const state of def.states) {
    const rows = { ...def.on["*"], ...def.on[state] };
    for (const [event, row] of Object.entries(rows ?? {})) {
      for (const t of (Array.isArray(row) ? row : [row]) as Transition<S, E, C>[]) {
        lines.push(`  ${state} --> ${t.target}: ${event}${t.guard ? " [guard]" : ""}`);
      }
    }
  }
  return lines.join("\n");
}
