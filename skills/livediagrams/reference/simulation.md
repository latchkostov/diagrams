# Simulations

Every diagram can play in live view, where messages animate along its flow edges. A saved simulation is a
scripted run: who sends what, what breaks and when, and what should hold true. It's stored in the diagram's
`simulations` list, so a share link carries it. Add one when the user wants to see the system run, or asks
"what happens if…". One or two per diagram is plenty.

## What each node does

The stencil's role (shown in [stencils.md](stencils.md)) decides how a node behaves:

- `source` starts traffic and sends a copy on every outgoing edge.
- `gateway` routes each message to one outgoing edge, round-robin.
- `processor` handles the message (250 ms, four at a time by default), may fail it, and sends a copy on every
  outgoing edge.
- `topic` and `stream` give every consumer group each message. The edges in one group (edge `props.group`)
  compete. An edge without a group is a group of its own.
- `queue` gives each message to one consumer (competing consumers).
- `store` is where messages end. Its outgoing async edges act as change feeds (CDC).
- `sink` is where messages end, without storage.
- `none` is decoration and passes messages straight through.

Dependency edges (with a `relation`) never carry traffic.

A topic or stream with no consumer keeps what's published: it isn't overloaded, and it has no lag (lag is per
consumer group). Live view says "Nobody reads Kafka Topic" and offers to add a consumer. More partitions don't help:
they cap how many consumers in one group work at once, and don't speed up publishing. A queue with no consumer
holds its messages until one takes them.

## Retries and dead letters

When a processor fails a message it got from a topic, queue or stream, the message goes back to that broker
and is redelivered. After `maxDeliveryCount` attempts (3 by default), the broker sends it down its dead-letter
edge and counts it as `deadLettered`. A dead-letter edge leaves the broker and has `"props": { "dlq": true }`,
or ends at a node labelled DLQ or dead-letter. A broker without one drops the message.

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

- Rates up to 10,000/s, bursts and injections up to 100,000 messages, times up to 600,000 ms.
- All traffic in the file together: at most 200,000 messages (rate × duration, summed).
- Expectation metrics: `processed`, `backlog`, `inFlight`, `failed`, `deadLettered`, `dropped`, `throughput`, `lag`, or `{ "system": "inSystem" }`; `op`: `<`, `<=`, `==`, `>=`, `>`; `when`: `always`, `eventually`, `end`, `at`.

<!-- END GENERATED sim-limits -->

## Telling a story

A good simulation runs 20 to 60 seconds: steady traffic, then an incident (a consumer goes down or slows, or a
spike arrives), then the recovery. Add a `note` with `pause: true` at each turn so a presenter can explain it,
and one or two expectations that make the point, such as nothing dead-lettered or the backlog draining. To
play it, open the link and press **Live** (or L).
