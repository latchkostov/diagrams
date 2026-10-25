/**
 * The pool-cohort lifecycle (sampling 8b; caller pools and deadlines in docs/SIMULATION.md).
 *
 * A sampled dot of N real requests that waits for a finite connection pool under a finite deadline is one
 * cohort: a FIFO template keeps the unsent members' queue place, the pool grants them in partial waves, and
 * the branch's one deadline is shared by every member. The first wave to settle decides the caller's single
 * outcome; after an OK first wave the remaining members settle on the edge alone (an orphan).
 *
 * This module owns only the cohort's state. Each transition updates that state first, then returns ordered
 * effects for the engine to apply: caller settlement, edge counters, the ledger and route credit stay with
 * their existing owners. Template disposal never completes a route: only a real journey's end does.
 *
 * Weights are real requests. Every open cohort conserves them: outstanding = remaining + Σ inFlight, and
 * unsent members keep their template (cohortConserved).
 *
 * States: bound (the caller's branch awaits its first settled wave), orphan (the branch replied OK; members
 * settle on the edge only), closed (terminal: nothing owned, outstanding = remaining = 0, no wave in flight).
 *
 * | event                    | bound                                       | orphan                                   | closed  |
 * | ------------------------ | ------------------------------------------- | ---------------------------------------- | ------- |
 * | open(N, expiresAt)       | (creates bound: N unsent, template queued)  |                                          |         |
 * | grant(lease, w)          | w unsent → in flight; the last unsent       | same                                     | ignored |
 * |                          | member releases the template [template]     |                                          |         |
 * | narrow(r)                | a half-open breaker refuses r unsent        | ignored                                  | ignored |
 * | settle(lease, ok)        | ORPHANING → orphan [decide at branch size]; | the wave settles; → close when empty     | ignored |
 * |                          | → close first when nothing else is owned    |                                          |         |
 * | settle(lease, failed)    | → closed [resize, close…, decide at branch  | WAVE FAILURE [failed w]; the queue and   | ignored |
 * |                          | size]                                       | deadline stay; → close when empty        |         |
 * | settle at/after deadline | [late w] + expire                           | [late w] + expire                        | ignored |
 * | expire(at)               | → closed [close(at)…, decide outstanding]   | → closed [timedOut + failed outstanding, | ignored |
 * |                          |                                             | close(at)…]                              |         |
 * | cancel                   | → closed [close…]                           | → closed [close…]                        | ignored |
 * | refuse (breaker open)    | ignored: a bound template asks the caller's | unsent fail fast [failed remaining,      | ignored |
 * |                          | breaker, whose refusal cancels              | template]; → close when empty            |         |
 *
 * close → closed: [template] while it is still owned, then [close] (unindex the cohort, then cancel its
 * deadline), then [release] each wave still in flight: retired now, or released at the shared deadline.
 * The template goes first because a released connection can synchronously wake the FIFO.
 *
 * The FIFO itself is the engine's: a template whose deadline passed before its expiry drained leaves the
 * queue, but the cohort keeps owning it (and its unsent members) until expire settles them.
 */

export type PoolCohortState = "bound" | "orphan" | "closed";

export interface PoolCohort<Call = unknown, Template = unknown> {
  readonly id: number;
  readonly call: Call;
  state: PoolCohortState;
  /** The FIFO template while it is owned: it keeps the unsent members' queue place. */
  template?: Template;
  /** Members this cohort carries; a half-open breaker can narrow it. */
  represented: number;
  /** Members not yet granted a connection. */
  remaining: number;
  /** Members not yet settled: remaining + Σ inFlight. */
  outstanding: number;
  /** Waves granted a connection and not yet settled: pool lease id → members. */
  inFlight: Map<number, number>;
  readonly expiresAt: number;
}

/** Ordered effects; weights are real requests. */
export type PoolCohortEffect<Template = unknown> =
  /** Drop the template's FIFO place, if it still has one, and release it without route credit. */
  | readonly [kind: "template", message: Template]
  /** Remove the cohort from its edge, then cancel its shared deadline. */
  | readonly [kind: "close"]
  /** A wave's connection: retired now, or released at the shared deadline `at`. */
  | readonly [kind: "release", lease: number, at?: number]
  /** A failed reply settles the caller's whole branch: its connection keeps that aggregate. */
  | readonly [kind: "resize", lease: number, weight: number]
  /** Add to the edge's call counter of the same name. */
  | readonly [kind: "failed" | "timedOut" | "late", weight: number]
  /** This event settles the caller, at `weight` or else at its branch's own size. */
  | readonly [kind: "decide", weight?: number];

type Effects<T> = PoolCohortEffect<T>[];

export function openCohort<Call, Template>(
  id: number,
  call: Call,
  template: Template,
  represented: number,
  expiresAt: number,
): PoolCohort<Call, Template> {
  return {
    id,
    call,
    state: "bound",
    template,
    represented,
    remaining: represented,
    outstanding: represented,
    inFlight: new Map(),
    expiresAt,
  };
}

function releaseTemplate<T>(c: PoolCohort<unknown, T>, effects: Effects<T>): Effects<T> {
  if (c.template !== undefined) effects.push(["template", c.template]);
  c.template = undefined;
  return effects;
}

function close<T>(c: PoolCohort<unknown, T>, effects: Effects<T> = [], at?: number): Effects<T> {
  releaseTemplate(c, effects).push(["close"]);
  for (const lease of c.inFlight.keys()) effects.push(["release", lease, at]);
  c.inFlight.clear();
  c.state = "closed";
  c.remaining = c.outstanding = 0;
  return effects;
}

/** The pool granted `weight` unsent members one connection lease. */
export function grantCohort<T>(c: PoolCohort<unknown, T>, lease: number, weight: number): Effects<T> {
  if (c.state === "closed") return [];
  c.inFlight.set(lease, weight);
  c.remaining = Math.max(0, c.remaining - weight);
  return c.remaining ? [] : releaseTemplate(c, []);
}

/** A half-open breaker admits only part of a bound template; the refused members short-circuit. */
export function narrowCohort(c: PoolCohort, refused: number): void {
  if (c.state !== "bound") return;
  c.represented -= refused;
  c.remaining -= refused;
  c.outstanding -= refused;
}

/** The shared deadline: every member still outstanding times out at `at`. */
export function expireCohort<T>(c: PoolCohort<unknown, T>, at: number): Effects<T> {
  const weight = c.outstanding;
  if (c.state === "closed") return [];
  if (c.state === "bound") return [...close(c, [], at), ["decide", weight]];
  return close(
    c,
    [
      ["timedOut", weight],
      ["failed", weight],
    ],
    at,
  );
}

/** One wave's reply, OK or failed, at `at`. */
export function settleWave<T>(c: PoolCohort<unknown, T>, lease: number, ok: boolean, at: number): Effects<T> {
  const weight = c.inFlight.get(lease) ?? 0;
  const before = c.outstanding;
  const bound = c.state === "bound";
  if (c.state === "closed") return [];
  // Equal-time replies lose to the deadline (raceReply).
  if (at >= c.expiresAt) return [["late", weight], ...expireCohort(c, at)];
  c.inFlight.delete(lease);
  c.outstanding = Math.max(0, before - weight);
  const effects: Effects<T> = ok ? [] : bound ? [["resize", lease, before]] : [["failed", weight]];
  // Orphaning: an OK first wave decides the caller; the rest settle on the edge.
  if (ok && bound) c.state = "orphan";
  if ((bound && !ok) || (!c.remaining && !c.inFlight.size)) close(c, effects);
  if (bound) effects.push(["decide"]);
  return effects;
}

/** The caller failed or left: unsent members are cancelled and in-flight connections retired. */
export function cancelCohort<T>(c: PoolCohort<unknown, T>): Effects<T> {
  return c.state === "closed" ? [] : close(c);
}

/** A breaker that opened after an orphan's OK first wave fails its unsent members fast. */
export function refuseCohort<T>(c: PoolCohort<unknown, T>): Effects<T> {
  if (c.state !== "orphan") return [];
  const effects = releaseTemplate(c, [["failed", c.remaining]]);
  c.outstanding -= c.remaining;
  c.remaining = 0;
  return c.inFlight.size ? effects : close(c, effects);
}

/** Conservation of real requests; a closed cohort owns nothing. */
export function cohortConserved(c: PoolCohort): boolean {
  let sent = 0;
  for (const weight of c.inFlight.values()) sent += weight;
  return (
    Math.abs(c.outstanding - c.remaining - sent) < 1e-8 &&
    c.remaining >= 0 &&
    (!c.remaining || c.template !== undefined) &&
    (c.state !== "closed" || (!c.outstanding && !c.inFlight.size && c.template === undefined))
  );
}
