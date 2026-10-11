// Message lineage for the engine: who went where, when, for one followed message and a bounded
// history of recent ones. The engine calls the hooks below as messages move; everything here is
// plain data (no randomness, no clocks of its own), so recording never changes a run and the whole
// state is captured by engine checkpoints. Semantics: docs/SIMULATION.md, "Message trace".

import type { MessageTrace, MessageTracer, TraceRequest, TraceStep, TraceSummary } from "./types";

/** Steps kept per message family. A longer journey (a retry storm, a feedback cycle) is truncated. */
export const MAX_STEPS = 600;
/** Upper bound for `setHistory`. */
export const MAX_HISTORY = 1000;

/**
 * Shared by a root message and every fan-out copy of it: each copy holds the same object, so the
 * engine can count the family's live copies and find its recording without any lookup.
 */
export interface Family {
  root: number;
  /** Copies travelling, queued or in process (parked ones included). */
  alive: number;
  /** Copies kept by a broker with no consumers (a dead-letter queue): their journey is over. */
  parked: number;
  trace?: MessageTrace;
}

/** Everything the tracer remembers. Engine checkpoints clone it together with the messages. */
export interface LineageState {
  /** Recorded families in creation order (the followed one included). */
  store: Map<number, Family>;
  following?: Family;
  /** followRoot() for a root that doesn't exist yet (after scrubbing back before it was created). */
  wanted?: number;
  request?: TraceRequest;
}

export interface LiveMessage {
  id: number;
  type: string;
  family: Family;
}

export interface LineageHost {
  time(): number;
  /** A live message (travelling, queued or in process) and the node it is at or leaving. */
  find(test: (message: LiveMessage) => boolean): { message: LiveMessage; node: string } | undefined;
}

export interface Lineage extends MessageTracer {
  state: LineageState;
  /** Forget every recording and request (load, reset). Keeps the history size. */
  reset(): void;
  /** A root message was created at `node`. Records its "emit" step when it's being recorded. */
  born(family: Family, type: string, node: string): void;
  /** A message reached `node` along `edge`; may start following it. Records the "arrive" step. */
  arrived(message: LiveMessage, node: string, edge: string): void;
  /** A broker dead-lettered a message after `attempt` deliveries; may start following it. */
  deadLettered(message: LiveMessage, node: string, attempt: number): void;
  /** Appends a step to the family's recording (callers check `family.trace` first). */
  record(family: Family, step: TraceStep): void;
  /** Marks the recording done once no copy is still on its way. */
  settle(family: Family): void;
}

export function createLineage(host: LineageHost): Lineage {
  let history = 0;
  let state: LineageState = { store: new Map() };

  function open(family: Family, type: string, origin: string, partial: boolean): void {
    family.trace = {
      rootId: family.root,
      type,
      origin,
      startedAt: host.time(),
      done: false,
      partial,
      truncated: false,
      steps: [],
    };
    state.store.set(family.root, family);
  }

  function settle(family: Family): void {
    const trace = family.trace;
    if (!trace || trace.done || family.alive - family.parked > 0) return;
    trace.done = true;
    trace.endedAt = host.time();
  }

  function follow(family: Family, type: string, node: string): void {
    if (!family.trace) open(family, type, node, true);
    state.following = family;
    state.request = undefined;
    state.wanted = undefined;
    settle(family);
  }

  /** Room for one more recording: evicts the oldest finished one that isn't followed. */
  function room(): boolean {
    if (state.store.size < history) return true;
    for (const [root, family] of state.store) {
      if (family === state.following || !family.trace?.done) continue;
      family.trace = undefined;
      state.store.delete(root);
      return state.store.size < history;
    }
    return false;
  }

  function trim(): void {
    for (const [root, family] of state.store) {
      if (state.store.size <= history) return;
      if (family === state.following || !family.trace?.done) continue;
      family.trace = undefined;
      state.store.delete(root);
    }
  }

  function record(family: Family, step: TraceStep): void {
    const trace = family.trace;
    if (!trace) return;
    if (trace.steps.length >= MAX_STEPS) trace.truncated = true;
    else trace.steps.push(step);
  }

  function summary(trace: MessageTrace): TraceSummary {
    let retries = 0,
      deadLettered = false,
      dropped = false;
    for (const step of trace.steps) {
      if (step.kind === "retry") retries++;
      else if (step.kind === "deadletter") deadLettered = true;
      else if (step.kind === "drop") dropped = true;
    }
    const { rootId, type, origin, startedAt, endedAt, done, partial } = trace;
    return { rootId, type, origin, startedAt, endedAt, done, partial, retries, deadLettered, dropped };
  }

  return {
    get state() {
      return state;
    },
    set state(next: LineageState) {
      state = next;
    },
    reset() {
      state = { store: new Map() };
    },
    born(family, type, node) {
      const request = state.request;
      if (
        state.wanted === family.root ||
        (request?.next === "message" && (request.node === undefined || request.node === node))
      ) {
        open(family, type, node, false);
        follow(family, type, node);
      } else if (history > 0 && room()) open(family, type, node, false);
      if (family.trace) record(family, { t: host.time(), kind: "emit", id: family.root, type, node });
    },
    arrived(message, node, edge) {
      const request = state.request;
      if (request?.next === "message" && request.node === node && state.following !== message.family)
        follow(message.family, message.type, node);
      if (message.family.trace)
        record(message.family, { t: host.time(), kind: "arrive", id: message.id, type: message.type, node, edge });
    },
    deadLettered(message, node, attempt) {
      if (state.request?.next === "deadletter" && state.following !== message.family)
        follow(message.family, message.type, node);
      if (message.family.trace)
        record(message.family, {
          t: host.time(),
          kind: "deadletter",
          id: message.id,
          type: message.type,
          node,
          attempt,
        });
    },
    record,
    settle,

    // ------------------------------------------------------------ MessageTracer
    setHistory(count) {
      history = Number.isFinite(count) ? Math.max(0, Math.min(MAX_HISTORY, Math.floor(count))) : 0;
      trim();
    },
    follow(messageId) {
      const found = host.find((message) => message.id === messageId);
      if (!found) return undefined;
      follow(found.message.family, found.message.type, found.node);
      return found.message.family.root;
    },
    followRoot(rootId) {
      const recorded = state.store.get(rootId);
      if (recorded) {
        state.following = recorded;
        state.request = undefined;
        state.wanted = undefined;
        return;
      }
      const found = host.find((message) => message.family.root === rootId);
      if (found) follow(found.message.family, found.message.type, found.node);
      else {
        state.following = undefined;
        state.request = undefined;
        state.wanted = rootId;
      }
    },
    request(next) {
      state.following = undefined;
      state.wanted = undefined;
      state.request = next.next === "message" ? { next: "message", node: next.node } : { next: "deadletter" };
    },
    clear() {
      state.following = undefined;
      state.wanted = undefined;
      state.request = undefined;
    },
    followed: () => state.following?.root ?? state.wanted,
    pending: () => (state.request ? { ...state.request } : undefined),
    current: () => (state.following?.trace ? structuredClone(state.following.trace) : undefined),
    get(rootId) {
      const trace = state.store.get(rootId)?.trace;
      return trace ? structuredClone(trace) : undefined;
    },
    recent() {
      const out: TraceSummary[] = [];
      for (const family of state.store.values()) if (family.trace) out.push(summary(family.trace));
      return out;
    },
  };
}
