# Simulations

Saved `simulations` script traffic, incidents and expectations in Live. Add one when requested;
shared diagram files and links carry the list.

## Roles and delivery

Stencil roles are listed in [stencils.md](stencils.md):

- `source` copies traffic to all outgoing flows; `gateway` selects one (round-robin).
- `processor` works on four messages concurrently for 250 ms by default, then copies outputs.
- `topic`/`stream` copy each message per consumer `props.group`; readers within a group compete.
  Without `group`, each edge is independent. `queue` readers always compete.
- `store` ends messages; async outputs are CDC. `sink` ends without storage; `none` passes through.
- Dependencies never carry traffic. Unread topics keep messages (no lag until a group reads);
  queues retain them. Partitions cap group readers, not publishing speed.

Broker-delivered processing failures retry up to `maxDeliveryCount` (default 3), then follow a
broker edge with `props.dlq: true` (or a DLQ/dead-letter target label), or drop without one.

## Faults and drills

A saved drill uses timeline `do: "fault"` actions. Four forms:

- `{ "kind": "boundary", "boundary": "zone-b", "down": true }`: down every nested member; restore with false.
- `{ "kind": "slow", "node": "api", "factor": 2 }`: 2, 5 or 10 times slower new attempts; clear with 1.
- `{ "kind": "fail", "node": "api", "rate": 0.1 }`: 10% or 50% injected failures; clear with 0.
- `{ "kind": "link", "edge": "cross-zone", "cut": true }`: a flow crossing two boundaries; restore with false.

Example: `{ "atMs": 3000, "action": { "do": "fault", "drill": "zone-outage", "fault": { "kind": "boundary", "boundary": "zone-b", "down": true } } }`.
Optional `drill` names: `zone-outage`, `region-connectivity`, `slow-dependency`, `error-spike` (the timeline's Add step presets).
Faults are checkpointed overlays, so scrubbing replays them and clearing preserves configured settings.
Broker deliveries wait behind a cut; pushed messages and Requests drop. Dependency outages and drill reports are not implemented.
Boundary membership changes restart playback. The public `zone-outage-drill` example compares health checks with no health checks.
WebMCP `set_simulation` accepts the same faults under `faults: [{ atSec, fault, drill? }]`, resolving element references.

## A saved simulation

```json
{
  "id": "payments-outage",
  "title": "Payments go down for 10 seconds",
  "traffic": [
    {
      "id": "checkout",
      "node": "web",
      "messageType": "OrderRequest",
      "label": "Checkout traffic",
      "shape": { "kind": "constant", "ratePerSec": 20, "durationMs": 30000 }
    }
  ],
  "timeline": [
    { "atMs": 0, "action": { "do": "note", "text": "Steady checkout traffic", "focus": ["web"] } },
    { "atMs": 8000, "action": { "do": "status", "node": "payments", "status": "down" } },
    {
      "atMs": 8000,
      "action": {
        "do": "note",
        "text": "Payments is down: retries, then the DLQ",
        "focus": ["payments"],
        "pause": true
      }
    },
    { "atMs": 18000, "action": { "do": "status", "node": "payments", "status": "up" } }
  ],
  "expectations": [
    {
      "id": "dead-lettered",
      "label": "Failed orders reach the DLQ",
      "metric": { "node": "orders", "field": "deadLettered" },
      "op": ">",
      "value": 0
    }
  ]
}
```

Times are milliseconds from the start, and rates and counts are real messages.

- **Traffic** `shape`: `burst` (`count`, `atMs`, `spreadMs`), `constant` (`ratePerSec`, `fromMs`, `durationMs`),
  `ramp` (`fromMs`, `startRate`, `stages: [{ "durationMs", "targetRate" }]`) or `spike` (`baseRate`,
  `peakRate`, `atMs`, `peakMs`, `durationMs`). Traffic usually starts at a source, a producer or a topic.
- **Timeline** `action`: `status` (`node`, `status`: up, paused or down), `props` (`node`, `props`, such as a
  higher `latencyMs`), `inject` (`node`, `count`, `messageType`, `spreadMs`), `note` (`text`, optional `focus`
  node ids, and `pause: true` to wait for the presenter) and `trace` (`node`: follow the next message there).
- **Expectations** are checked live. A `when` of `end` (the default) is checked when the run ends, `always`
  must hold throughout, `eventually` must hold at some point, and `at` is checked at `atMs`.
- `setup` (optional) applies settings before the start, for example
  `{ "status": { "payments": "paused" }, "props": { "payments": { "replicas": 2 } } }`.
- `scale` (optional) sets how many real messages one animated dot stands for. Keep the animation under about 60
  dots a second: for 2,000 orders a second, use `"scale": 50`. `validate.mjs` suggests a value when one is
  needed.
- `durationMs` (optional) stops the run. By default it stops once the traffic and timeline are done and the
  system has drained.

<!-- BEGIN GENERATED sim-limits -->

- Rates up to 10,000,000/s, bursts and injections up to 100,000 messages, times up to 600,000 ms.
- All traffic in the file together: at most 200,000 messages as played (rate × duration, summed, ÷ each simulation's `scale`, the real messages per dot).
- Expectation metrics: `processed`, `backlog`, `inFlight`, `failed`, `timedOut`, `retried`, `amplification`, `goodput`, `threadsBusy`, `threadsWaiting`, `deadLettered`, `dropped`, `blocked`, `rejected`, `throughput`, `lag`, or `{ "system": "inSystem" }`; `op`: `<`, `<=`, `==`, `>=`, `>`; `when`: `always`, `eventually`, `end`, `at`.

<!-- END GENERATED sim-limits -->

## Telling a story

A good simulation runs 20 to 60 seconds: steady traffic, then an incident (a consumer goes down or slows, or a
spike arrives), then the recovery. Add a `note` with `pause: true` at each turn so a presenter can explain it,
and one or two expectations that make the point, such as nothing dead-lettered or the backlog draining. To
play it, open the link and press **Live** (or L).

## Requests that wait

Use `planning.revision: "p3-w2"` for retries and `p3-w1` for waiting calls; preserve older revisions.
Threads are replicas × concurrency. A Request's `props.caller` accepts `wait: "blocking" | "non-blocking"`,
`replyMs` (10 ms by default), `deadlineMs` and `poolConnections`. Services/functions hold threads by default;
gateways/proxies/workflows free them. Freeing threads retains in-flight memory and needs a reply continuation.
Timeouts include pool wait. A timed-out queued call is never sent; dispatched work can return a late reply.

Show the lesson with `threadsBusy`, `threadsWaiting` or `timedOut` expectation metrics in real counts.
The thread ceiling is threads × 1,000 ÷ hold milliseconds. CPU can stay low while waiting fills every thread;
HPA/KEDA's modelled `busyThreads` metric can scale on working plus waiting threads. It requires a custom
metrics adapter in a real deployment. Checks and live callouts share the verified fix selector; timeout
suggestions fit the caller's thread budget rather than using a universal one-second minimum.
