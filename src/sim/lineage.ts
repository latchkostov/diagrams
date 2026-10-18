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
  /** Root birth in simulation ms, shared by every branch, independently of trace sampling. */
  bornAt: number;
  root: number;
  /** Copies travelling, queued or in process (parked ones included). */
  alive: number;
  /** Copies kept by a broker with no consumers (a dead-letter queue): their journey is over. */
  parked: number;
  /** Request routing: the routes this journey has finished once already (fan-out copies don't count twice). */
  routesDone?: string[];
  trace?: MessageTrace;
}

/** Families are cloned with engine messages; trace records are shared with copy-on-write. */
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
  /** Request routing: the address it carries (its route id goes on every step). */
  request?: { id: string };
}

export interface LineageHost {
  time(): number;
  /** A live message (travelling, queued or in process) and the node it is at or leaving. */
  find(test: (message: LiveMessage) => boolean): { message: LiveMessage; node: string } | undefined;
}

export interface Lineage extends MessageTracer {
  state: LineageState;
  /** Protect records shared with a checkpoint from later mutation. */
  shareRecords(): void;
  /** Forget every recording and request (load, reset). Keeps the history size. */
  reset(): void;
  /** A root message was created at `node`. Records its "emit" step when it's being recorded. */
  born(family: Family, type: string, node: string, route?: string): void;
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
  const shared = new WeakSet<MessageTrace>();

  function writable(family: Family): MessageTrace | undefined {
    const trace = family.trace;
    if (trace && shared.has(trace)) family.trace = { ...trace, steps: [...trace.steps] };
    return family.trace;
  }

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
    const next = writable(family)!;
    next.done = true;
    next.endedAt = host.time();
  }

  function follow(family: Family, type: string, node: string): void {
    if (!family.trace) open(family, type, node, true);
    state.following = family;
    state.request = undefined;
    state.wanted = undefined;
    trim();
    settle(family);
  }

  /** Automatic sampling keeps in-flight history; explicit following can replace any old slot. */
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
      if (state.store.size <= Math.max(history, state.following ? 1 : 0)) return;
      if (family === state.following) continue;
      family.trace = undefined;
      state.store.delete(root);
    }
  }

  function record(family: Family, step: TraceStep): void {
    const trace = writable(family);
    if (!trace) return;
    if (trace.steps.length >= MAX_STEPS) trace.truncated = true;
    else trace.steps.push(step);
  }

  function summary(trace: MessageTrace): TraceSummary {
    let retries = 0,
      deadLetteredAt: number | undefined,
      dropped = false,
      blocked = false,
      rejected = false;
    for (const step of trace.steps) {
      if (step.kind === "retry") retries++;
      else if (step.kind === "deadletter") deadLetteredAt = step.t;
      else if (step.kind === "drop") dropped = true;
      else if (step.kind === "block") blocked = true;
      else if (step.kind === "reject") rejected = true;
    }
    const { rootId, type, origin, startedAt, endedAt, done, partial } = trace;
    const deadLettered = deadLetteredAt !== undefined;
    return {
      rootId,
      type,
      origin,
      startedAt,
      endedAt,
      done,
      partial,
      retries,
      deadLettered,
      ...(deadLettered ? { deadLetteredAt } : {}),
      dropped,
      blocked,
      ...(rejected ? { rejected: true } : {}),
    };
  }

  return {
    shareRecords() {
      for (const family of state.store.values()) if (family.trace) shared.add(family.trace);
    },
    get state() {
      return state;
    },
    set state(next: LineageState) {
      state = next;
    },
    reset() {
      state = { store: new Map() };
    },
    born(family, type, node, route) {
      const request = state.request;
      if (
        state.wanted === family.root ||
        (request?.next === "message" && (request.node === undefined || request.node === node))
      ) {
        open(family, type, node, false);
        follow(family, type, node);
      } else if (history > 0 && room()) open(family, type, node, false);
      if (family.trace)
        record(family, { t: host.time(), kind: "emit", id: family.root, type, node, ...(route ? { route } : {}) });
    },
    arrived(message, node, edge) {
      const request = state.request;
      if (request?.next === "message" && request.node === node && state.following !== message.family)
        follow(message.family, message.type, node);
      if (message.family.trace)
        record(message.family, {
          t: host.time(),
          kind: "arrive",
          id: message.id,
          type: message.type,
          node,
          edge,
          ...(message.request ? { route: message.request.id } : {}),
        });
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
          ...(message.request ? { route: message.request.id } : {}),
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
        follow(recorded, recorded.trace!.type, recorded.trace!.origin);
        return;
      }
      const found = host.find((message) => message.family.root === rootId);
      if (found) follow(found.message.family, found.message.type, found.node);
      else {
        state.following = undefined;
        state.request = undefined;
        state.wanted = rootId;
        trim();
      }
    },
    request(next) {
      state.following = undefined;
      state.wanted = undefined;
      state.request = next.next === "message" ? { next: "message", node: next.node } : { next: "deadletter" };
      trim();
    },
    clear() {
      state.following = undefined;
      state.wanted = undefined;
      state.request = undefined;
      trim();
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
