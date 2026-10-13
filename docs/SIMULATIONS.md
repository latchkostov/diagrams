# Simulations: saved, replayable "what if" runs on any diagram

A **simulation** is part of the diagram file (`DiagramFile.simulations`), so it saves, exports and
imports with the diagram, and anyone can author one with the UI. It answers questions like _"what
happens when 100 new members join at once?"_ or _"what if the payments consumer dies mid-batch?"_
Types: `Simulation` in `src/model/types.ts`; runner API in `src/sim/types.ts`.

## Prior art it borrows from

- **Load testing (k6 / Gatling):** traffic as _shapes_: a burst ("atOnceUsers"), constant arrival
  rate, k6-style ramping stages, spikes. Open model: messages start regardless of system response.
- **Chaos engineering (Chaos Toolkit):** a _steady-state hypothesis_ (expectations that must hold) plus a
  _method_ (timed actions that disturb the system), with the hypothesis checked during and after.
- **Presenting (IcePanel Flows):** narrated, step-by-step storytelling. Here, narration notes on the
  timeline can highlight nodes and pause playback until the presenter continues.

Nothing we found combines these on _your own_ architecture diagram: existing system-design simulators
use generic boxes, and Kafka visualizers simulate a fixed toy topology.

## Anatomy

```jsonc
{
  "id": "member-storm",
  "title": "100 new members join",
  "seed": 7,
  "setup": { "props": { "welcome-svc": { "concurrency": 2 } } },
  "traffic": [
    {
      "id": "t1",
      "node": "signup-api",
      "messageType": "MemberJoined",
      "label": "Signup storm",
      "shape": { "kind": "burst", "count": 100, "spreadMs": 3000 },
    },
  ],
  "timeline": [
    { "atMs": 0, "action": { "do": "note", "text": "100 people sign up in 3 seconds", "focus": ["signup-api"] } },
    { "atMs": 4000, "action": { "do": "status", "node": "email-svc", "status": "down" } },
    {
      "atMs": 4000,
      "action": { "do": "note", "text": "Email provider outage", "focus": ["email-svc"], "pause": true },
    },
    { "atMs": 12000, "action": { "do": "status", "node": "email-svc", "status": "up" } },
  ],
  "expectations": [
    {
      "id": "e1",
      "label": "Every member gets a profile",
      "metric": { "node": "profiles-db", "field": "processed" },
      "op": "==",
      "value": 100,
    },
    {
      "id": "e2",
      "label": "Nothing is dead-lettered",
      "metric": { "node": "member-events", "field": "deadLettered" },
      "op": "==",
      "value": 0,
      "when": "always",
    },
  ],
}
```

## Typed messages

Messages carry a `type`. Two small props make flows realistic without code:

- **Edge filter** `edge.props.filter: ["Order*"]`: only matching types travel that edge (like Service
  Bus subscription filters or a routing key). A broker group whose edges all reject a message skips it.
- **Emits** `node.props.emits`: a processor renames what it sends downstream
  (`"PaymentCompleted"`, or a map `{ "MemberJoined": "WelcomeEmailRequested", "*": "AuditLogged" }`);
  `edge.props.emits` overrides per edge.

## Runner semantics (`createSimulationRun`)

- Loads the diagram into an engine with the simulation's `seed`, applies `setup`, then plays.
- **Traffic:** each profile has a rate function r(t) in real msgs/s; the runner integrates it with an
  accumulator each step, applies `multipliers.traffic / scale`, and calls `engine.inject(node, n, { type })` (bursts use `spreadMs`).
  `trafficRateAt(shape, t)` is exported for previews (sparklines in the editor).
- **Timeline:** actions fire when sim time crosses `atMs`, in order. A `note` with `pause: true` sets
  `waiting` until `resume()`. A `trace` step (`{ "do": "trace", "node": "orders" }`) follows the next
  message to reach that node, so a presentation can show one order's journey and its sequence diagram.
- **Expectations:** evaluated every step. `always` fails on first violation; `eventually` passes on first
  success; `end` / `at` are pending until checked. Status is `pending | pass | fail`, and the latest value is kept in real units.
- **Done:** at `durationMs`, or once traffic and timeline are finished and nothing is in the system
  (plus a short drain grace), with a hard cap.
- Deterministic: same diagram + simulation + seed ⇒ same run.

## UI (live view)

- **Control bar:** play/pause, speed, restart, a simulation picker ("Free play" + saved simulations),
  a timeline scrubber with markers (notes, chaos actions, traffic windows), and live expectation chips.
- **Narration callouts** anchored near focused nodes; others dim while a note is active.
- **Authoring panel:** add a traffic profile (start node, message type, shape editor with a live rate
  sparkline), add timeline steps (pick node, action, time), add expectations (metric picker, op, value).
- **Quick start from the canvas:** right-click a node → _Simulate from here…_, e.g. "Send a burst of
  100 `MemberJoined`", which creates a simulation you can save, tweak and replay.

## Inputs & capacity

Save entry rates/counts in real units. `scale` is a sampling weight, not a traffic multiplier:
`scale: 50` means one animated dot represents 50 messages. `autoScale(simulation, diagram)` chooses
a round 1/2/5-series value for at most ~60 entry dots/s. Exact low-count presentations can use 1;
coarse sampling rounds away a final remainder smaller than one dot.

```jsonc
{
  "id": "black-friday",
  "title": "Black Friday: 2,000 orders/s",
  "scale": 50,
  "multipliers": { "traffic": 1, "capacity": 1 },
  "setup": { "props": { "payments": { "replicas": 6, "concurrency": 64, "jitter": 0.2 } } },
  "traffic": [
    { "id": "orders", "node": "shopper", "shape": { "kind": "constant", "ratePerSec": 2000, "durationMs": 10000 } },
  ],
}
```

`createSimulationRun` exposes `setMultipliers({ traffic?, capacity? })` for live sliders. Capacity
multiplies base replicas with rounding and a minimum of one, respecting topic partitions. It does
not overwrite saved/setup/timeline props. Traffic applies to future input; previously scheduled burst
batches remain fixed. Restart restores saved values. `state()` includes the current scale/multipliers.

For the panel, `analyzeCapacity(diagram, simulation)` returns real per-node `capacity`, `offered`,
`utilization`, replica assignments, a bottleneck node and a human suggestion. Recompute with current
slider values and setup overrides, without starting a run. A false `converged` flags cycle uncertainty.
The analysis uses nominal peak demand; gateway/store capacities are single-lane planning estimates,
while playback permits parallel requests. See `docs/SIMULATION.md` for assumptions and exact routing.

For rendering, use `engine.frame()`; detailed event inspection still uses `snapshot()`. Both expose
`scale`. Convert node message metrics with `realNodeMetrics(node, scale)`; keep replicas, clocks and
particle geometry unscaled. Runner expectation values already use real units and need no conversion.

The public scenarios now save explicit scales. Kafka Black Friday sends 2,000 real orders/s with scale
50 and a matching service fleet. The partition-hot-spot scenario uses 64 replicas at concurrency 1,
so increasing partitions actually activates idle instances. Poison invoices demonstrate in-place
retries with backoff. Other presentations sample batches and spikes while preserving their real-count
expectations. Edge `share` models optional branches; `retry` and `retryBackoffMs` control broker retries.

## Played headless: Run simulations

The Checks card's **Run simulations** plays every saved simulation without going live (`src/checks/evidence.ts`, in a
worker): from its own seed, a 10 ms tick at a time, at most 60 s of simulated time each and about 15 s of wall-clock
time in all, resuming pausing notes at once. It counts only lost messages (dropped, and dead letters left unread) and
puts them on the checks' findings. What a simulation loses on purpose (a node it takes down or makes fail, or what its
own expectations count on) is reported as such, never as a finding: write an expectation of the loss (`dropped > 0`)
when the loss is the story, and of none (`dropped == 0`) when it shouldn't happen. See
`docs/research/architecture-checks.md`, "Batch 5: as built".
