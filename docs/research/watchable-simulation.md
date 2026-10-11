# Watchable simulation: slow motion for one message, calmer slow speeds

Research for the owner's feedback, written 2026-10-11.

> "Our 0.25× speed is still quite fast. There's a lot of messages coming through... so people can
> actually watch individual things flow through and not just a bunch of dots flying across the screen."
>
> Headline scenario: "See an individual flow happen node by node, almost like slow motion: from the
> start of the diagram, something flowing through some Kafka consumers or whatever, then hitting some
> databases and doing whatever else it needs to do."

**TL;DR.** Slowing down doesn't help, because speed changes how fast dots move, not how many there are.
At 0.25× the screen shows the same 110–165 dots as at 1×. They already move slowly enough to follow
(2–9°/s). The problem is that there are too many of them, they're too dense, and nothing pauses long
enough to be seen. We recommend one new idea, **Slow motion**: a replay of one message's recorded
journey (from the lineage we already keep), with fixed per-hop pacing. Each hop shows a "processing"
pause with a caption, fan-out copies split together, and database writes read as writes. The rest of
the system is frozen and dimmed, and the replay can be recorded. We also recommend a quiet renderer
default: below 1×, draw whole journeys of a sample of messages instead of every dot, so 0.25× shows
about 15–30 dots instead of about 120–165. Counters stay exact.

---

## 1. How it works today (what matters for this problem)

- **Clock.** The engine has a fixed 10 ms step. `speed` (0.25–8×, `SPEEDS` in `src/live/controller.ts`)
  only scales wall time to simulated time. A trip's `start`/`end` are in simulated time, and `travelMs`
  defaults to 900 ms (async) or 450 ms (sync). All public examples override it to 100–300 ms.
- **Density.** The number of dots on one edge at once is `sampledRate × travelMs`, in simulated units,
  so **speed doesn't change it**. Speed only changes how fast each dot moves and how many reach an
  edge per wall second (`sampledRate × speed`).
- **Scale.** `scale` is a sampling weight (1 dot = N real messages). `autoScale` aims for about 60 entry
  dots/s. Fan-out, sync replies and DLQ multiply that downstream.
- **Renderer** (`src/live/particleRenderer.ts`). Movement is linear in `progress`, with no easing and
  no pause at nodes. `densityStride` thins a crowded edge by particle id, so the same message can be
  visible on one edge and hidden on the next. The engine caps drawn particles at 1,500. A trace dims
  everything else to 20–28% alpha and labels the traced copies.
- **Trace** (`src/sim/lineage.ts`, `TraceCard.tsx`, `src/trace/journey.ts`). The engine records a
  family's full journey: `emit, copy, send(until), arrive, start, done, fail, retry, deadletter, drop,
park, end`, with simulated timestamps. It's deterministic, cloned in checkpoints, and draws no random
  numbers. `traceOnce` (`src/trace/headless.ts`) already runs a trace without the UI.
- **Step** (in the ⋯ menu) advances a fixed 250 ms of simulated time, not one event.
- **Camera.** `fitView` with `NOTE_FIT` (900 ms) is used for narration focus.
- **Record video** (`src/live/record/*`) records in presentation view. With a simulation picked, the
  one option is "play it from the start and stop when it ends".

## 2. Measurements

Setup: `pnpm dev --port 5402`, Chrome DevTools MCP in an isolated context, 1440×900 viewport, public
examples only. I sampled the live controller's `snapshot()` every animation frame for 4–8 s, plus the
canvas's `data-particles` (dots actually drawn after thinning). "New dots/s" counts particles entering
an edge (sync replies included) per **wall** second.

| Example · run                       |   Speed   | Scale | In system (avg) | Drawn (avg / max) | New dots/s on busiest edge  | Max on one edge |                   New dots/s, whole screen                   |
| ----------------------------------- | :-------: | :---: | :-------------: | :---------------: | :-------------------------: | :-------------: | :----------------------------------------------------------: |
| Kafka · Free play (25 orders/s)     |    1×     |   1   |       125       |     113 / 122     | 104 (orders→db), 52 typical |       25        |                             575                              |
| Kafka · Free play                   | **0.25×** |   1   |     **125**     |   **113 / 122**   |       28, 14 typical        |       24        |                             153                              |
| Kafka · Black Friday (2,000/s)      |    1×     |  50   |       194       |     126 / 134     |       148, 84 typical       |       38        |                             891                              |
| Kafka · Black Friday                | **0.25×** |  50   |     **197**     |   **126 / 136**   |       39, 22 typical        |       38        |                             241                              |
| Kafka · Payments outage (50/s)      | **0.25×** |   1   |       245       |     165 / 182     |       47, 27 typical        |       48        |                             297                              |
| AWS fan-out · Steady + spike, base  |   0.25×   |   2   |       14        |      10 / 21      |             4.3             |        4        |                              18                              |
| AWS fan-out · Steady + spike, spike |   0.25×   |   2   |       79        |     48 / 105      |             24              |       23        |                              97                              |
| IoT · Morning ramp                  |   0.25×   |  10   |       17        |      11 / 22      |             9.9             |       11        |                              31                              |
| Azure invoices · Free play          |   0.25×   |   1   |        0        |         0         |              0              |        0        | 0 (no `source` node, so free play is empty until you inject) |

**One order, end to end** (Kafka free play, traced from Storefront at 0.25×):

- It takes 2.42 s simulated, which is **9.8 s of wall time**, over 74 lineage steps and 6 message ids
  (1 root + 5 fan-out copies).
- There are 13 forward hops plus sync replies and 4 database writes (orders db twice, stock db,
  payment ledger), plus a Redis write.
- Processing pauses are 40–180 ms simulated, which is **0.16–0.72 s of wall time** at 0.25×. Hops are
  200–300 ms simulated (0.8–1.2 s wall).
- Up to **4 copies move at once**: stock-db, payment-db, notify-cache and payment-events, between
  5,040 and 5,290 ms.
- Meanwhile about 60 other orders are in flight, about 120 other dots.

**Ratios.** In Black Friday at 0.25×, the viewer sees about 10 entry dots per wall second, which stand
for about 500 real orders per wall second (2,000/s × 0.25). In Kafka free play at 0.25×, it's 6.5 entry
dots/s, 1 dot = 1 order.

**Dot speed.** At 0.25×, edges are 70–330 px on screen and take 0.8–1.2 s, so dots move at 90–410 px/s.
On a laptop at 60 cm, 1° of visual angle is about 44 CSS px, so that's **about 2–9°/s**. That's already
slow, well inside comfortable smooth pursuit (gain near 1 for roughly 10–50°/s
[[Versino 1990 via PMC]](https://pmc.ncbi.nlm.nih.gov/articles/PMC1190396);
[[Buizza & Schmid 1986]](https://iris.unipv.it/handle/11571/454225)). At 1× it's 8–37°/s.

**Conclusions from the numbers**

1. **Slowing down only reduces velocity.** Count and spacing don't change: 113 dots drawn at 1× and
   at 0.25×. Adding 0.1× or 0.05× would make each dot crawl at 0.5–2°/s and still leave 110+ on
   screen. **Slower speeds aren't the answer.**
2. **Busy edges carry 10–40 dots at once and look like strings of beads** (see the payments-outage
   view at 4 s), well past what attention can individuate (section 3).
3. **Nothing ever pauses.** A processing step is 0.2–0.7 s of wall time even at 0.25×, and a gateway
   step is 0.28 s, so the eye never sees "arrive → work → leave". Hops have no slow-in or slow-out.
4. **The current thinning breaks journeys.** `p.id % crowd` picks per trip, so a message you follow
   can disappear at the next hop.
5. **A single message is short.** A whole Kafka order is 2.4 s simulated. Telling it as a story takes
   about 15–20 s of wall time, which fits a Slack clip or a slide.

## 3. What the research says

### Perception

- **Tracking capacity is about 4, and it depends on speed and crowding.** Multiple-object tracking
  (Pylyshyn & Storm 1988) is usually cited as about 4 targets among identical distractors
  [[Wikipedia: MOT]](https://en.wikipedia.org/wiki/Multiple_object_tracking). Alvarez & Franconeri
  (2007) showed the limit isn't fixed: **up to 8 at slow speeds, as few as 1 at fast speeds**
  [[J. Vision PDF]](https://visualcognition.psych.northwestern.edu/publications/AlvarezTracking2007.pdf).
  Franconeri et al. (2010) argue that speed hurts mainly by increasing **crowding**
  [[Psych Sci PDF]](https://visualcognition.psych.northwestern.edu/publications/FranconeriPsychSci2010.pdf).
  For us: the subject should be at most about 4 moving things, well spaced. 30–48 dots on one edge
  is far past the limit at any speed.
- **Motion onset captures attention.** Something that starts moving draws attention involuntarily
  [[Abrams & Christ 2003]](https://pubmed.ncbi.nlm.nih.gov/12930472/), even at isoluminance
  [[Guo et al. 2010]](https://link.springer.com/article/10.3758/APP.72.5.1311). With 150 dots starting
  each second, every one of them competes with the message you're trying to follow. Background
  traffic should be **frozen**, not just dimmed.
- **Change blindness.** Large changes go unnoticed when motion transients happen elsewhere in the image
  [[Rensink, O'Regan & Clark 1997; Simons & Rensink 2005]](https://www.cs.ubc.ca/~rensink/publications/download/S&R-TICS-05a.pdf).
  A type rename (OrderPlaced → PaymentCompleted) or a write is missed when it happens during a crowd
  of other motion. Changes should happen while **everything else is still**, ideally during a pause.
- **Speed.** Smooth pursuit is accurate across ordinary speeds (above). Comprehension suffers when
  motion is too fast **or too complex** to perceive
  [[Tversky, Morrison & Bétrancourt 2002]](https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf).
  Here the problem is complexity, not velocity. Target a mean of 5–7°/s, about 220–300 px/s on a
  laptop.

### Explanatory animation

- **Staging, simplicity and apprehension.** Heer & Robertson (2007) found animated transitions improve
  graphical perception when they're simple. Complex changes should be **staged** into a sequence of
  simple steps, and a transition should last "as long as needed, but no longer"
  [[paper]](https://homes.cs.washington.edu/~jheer/files/2007-AnimatedTrans-InfoVis.pdf);
  [[UW CSE442 lecture]](https://courses.cs.washington.edu/courses/cse442/24au/lectures/CSE442-Animation.pdf).
  One hop is one stage, and one node's work is one stage.
- **Slow-in, slow-out.** Dragicevic et al. (2011) found slow-in/slow-out beats constant speed for
  object tracking in most transitions [[PDF]](https://cs.au.dk/~elm/pdf/timedistort.pdf). Use eased
  hops in slow motion. Live throughput view stays linear, because there speed encodes latency, as in
  Kiali.
- **Staggering doesn't help tracking.** Chevalier, Dragicevic & Franconeri (2014) found staggered
  starts had a negligible effect and lose common-fate grouping
  [[PDF]](https://visualcognition.psych.northwestern.edu/publications/ChevalierDragicevicFranconeri2014.pdf).
  Fan-out copies should **leave together** and move as a group (common fate), not one after another.
- **Animation isn't automatically better.** People mentally break continuous events into discrete
  steps, and many "animation wins" weren't fairly compared with a sequence of stills. Interactivity
  (pause, step) offsets this (Tversky et al. 2002, above).
- **Segmenting.** Learners do better with **user-paced segments** than with one continuous animation:
  Mayer & Chandler 2001 used 16 segments of 8–10 s each with a Continue button; 10 of 10 experiments
  favoured segmenting, median d = 0.79
  [[Mayer, Cambridge Handbook]](https://www.cambridge.org/core/books/multimedia-learning/segmenting-principle/37240877DDA0362355ADB39936027982);
  [[review, Springer 2024]](https://link.springer.com/article/10.1007/s10758-024-09745-2).
  For us: play, pause and **next hop** controls.
- **Animation principles** (Disney's, as adapted for UI). Staging means one idea at a time, with
  everything else quiet. Anticipation means a short cue before departure. Slow in/out is covered above.
  Hold the end state long enough to read it.

### Prior art: "watch one" vs. "see the volume"

| Tool                                                                                                                                                             | Volume view                                                                                                         | Watch-one view                                                                                                                                                                    | Takeaway                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cisco Packet Tracer**, Simulation mode [[help]](https://tutorials.ptnetacad.net/help/default/mode_simulation.htm)                                              | Realtime mode (no packets drawn)                                                                                    | A separate mode where **time advances by events**: Auto Capture/Play, a speed slider, **Capture/Forward = one event**, Back, and an **Event List** with per-PDU details           | The two views are separate modes. Event stepping plus an event list is the canonical way to learn. Our trace card is already the event list. |
| **Kiali** [[topology docs]](https://v1-82.kiali.io/docs/features/topology)                                                                                       | Dot **density = request rate, dot speed = response time**, red diamonds = errors                                    | Click a node or edge for details. No single-request story.                                                                                                                        | Dots are an **encoding, not a census**: drawing fewer dots than requests is accepted practice.                                               |
| **IcePanel Flows** [[docs]](https://docs.icepanel.io/features/flows)                                                                                             | none                                                                                                                | An ordered list of steps on the diagram: Play, Back/Next, arrow keys, an intro step showing all steps                                                                             | Presenters want to step on demand. The steps are authored by hand; ours come from a real simulated journey.                                  |
| **SoftwareMill / Aiven Kafka visualizers** [[SoftwareMill]](https://softwaremill.com/kafka-visualisation), [[Aiven]](https://aiven.io/tools/kafka-visualization) | A fixed toy cluster with a few large labelled records                                                               | Every record is big and slow and there are few of them, which only works because the topology is a toy                                                                            | Low density is a deliberate choice: few objects, each labelled.                                                                              |
| **Factorio** belts [[wiki]](https://wiki.factorio.com/Transport_belts/Physics)                                                                                   | Throughput = **density × speed**. Faster belts move faster at the **same density** (max 4 items per tile per lane). | You look at a single machine. Items are big and fixed-spaced.                                                                                                                     | Same physics as our edges: speed never reduces density. Readability comes from a density cap.                                                |
| **Mini Metro** [[design notes]](https://mechanicsofmagic.com/2023/04/22/visual-design-of-games-mini-metro/)                                                      | Waiting passengers **stack as small shapes at stations**, not as streams                                            | Few trains, each moving slowly                                                                                                                                                    | Show queues as stacks at nodes. Keep moving things few.                                                                                      |
| **VisuAlgo** [[site]](https://visualgo.net/), algorithm visualizers                                                                                              | Speed slider                                                                                                        | **Step forward/back** through algorithm events, often the most useful mode per reviews [[review]](https://www.thedailystar.net/shout/website-review/mastering-algorithms-1240150) | Stepping by event beats a continuous clock.                                                                                                  |
| **Bret Victor, Ladder of Abstraction** [[essay]](http://worrydream.com/LadderOfAbstraction/)                                                                     | Abstract over time (plots of all runs)                                                                              | **Scrub to any moment, stop at events, jump between them**                                                                                                                        | The reader controls time. Our timeline scrubber does this; slow motion should get the same control.                                          |
| **Explorable explanations (Nicky Case)** [[Data Stories #103]](https://datastori.es/103-explorable-explanations-with-nicky-case/)                                | Simulations with many agents                                                                                        | Start with **one agent** and add the crowd later                                                                                                                                  | Show one first, then the volume.                                                                                                             |

The pattern across all of them: **watching one** and **seeing the volume** are two different views.
Watching one uses event pacing, few objects, labels and stepping. Seeing the volume uses an encoding
(density or rate) and doesn't promise one dot per item. Our 0.25× tries to be both and does neither.

## 4. Options evaluated

| Option                                                                                                           | Verdict                             | Why                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.1× / 0.05× speeds**                                                                                          | Reject                              | The measurements show the problem is count, not velocity. Dots would crawl at 0.5–2°/s with 110+ still on screen, and runs would take 10–40× longer. |
| **Decouple drawn density from throughput below 1×** (a sampling ratio that grows as speed drops, counters exact) | **Adopt (part B)**                  | Fixes "a bunch of dots" for general viewing with no new control. Must thin **by message family**, so you see whole journeys.                         |
| **"Watch" story mode** (inject few messages, spaced and labelled)                                                | Reject                              | Changes what's simulated: conflicts with saved traffic, expectations, `scale`, and the honesty of "what happens at 2,000/s".                         |
| **One at a time, live** (inject 1, follow it, then the next)                                                     | Fold into A                         | That's a trace plus pacing. Done as a replay, it doesn't disturb the run.                                                                            |
| **Event stepping** (Packet Tracer)                                                                               | Adopt inside A                      | "Next hop" steps through the replay's beats. On the live engine, stepping makes everything else jump too.                                            |
| **Easing and dwell at nodes**                                                                                    | Adopt inside A                      | Can't be done in the live engine without changing its timing, but it's natural in a replay.                                                          |
| **Per-edge caps with "×12" pills**                                                                               | Later                               | Good for an overview at 4–8×, not for watching individuals. A label per edge adds clutter (Nothing overlaps).                                        |
| **Dim the rest while highlighting one**                                                                          | Already exists (trace). Go further. | 20–28% alpha still leaves 120 dots _moving_, and motion onset still captures attention. Freeze them.                                                 |
| **Auto-follow a message at slow speeds**                                                                         | Reject as a default                 | Surprising (No surprises). The camera would fight users who pan. Offer it explicitly via Slow motion.                                                |
| **Named speed steps (Watch / Normal / Fast)**                                                                    | Reject                              | "Watch" becomes Slow motion, a different thing from speed. Keep the six numeric speeds.                                                              |

## 5. Recommendation

One new concept, **Slow motion**: a paced replay of one message's journey. Plus one quiet default:
**calmer drawing below 1×**. The speed control doesn't change.

### A. Slow motion: watch one message, node by node

**What the viewer sees (the Kafka order).** The camera eases to fit the order's path. Everything else
freezes and fades back. "Storefront sends OrderRequest" appears for a beat. The dot lifts off,
eases along the edge, and lands at the Commerce gateway. A thin ring around the gateway fills while
"Commerce gateway · route POST /orders · 70 ms" shows. It moves on to the Order service and pauses
with "Order service · commit order + outbox · 180 ms". Then **three copies split together**: one drops
into the Orders database ("write OrderPlaced · 40 ms"), one goes to the Schema registry, and one goes to
`orders.created.v1`. There it settles into the log ("appended · keyed by orderId"). The topic fans out
to Inventory, Payments and Notification together. Each processes, each writes to its store,
Payments emits PaymentCompleted, the Order service consumes it, and the run ends with a final
`OrderUpdated` write. A summary holds: "Done · 2.42 s real · 6 copies · 5 writes". About **17–20 s** of
wall time, never more than 4 moving dots.

#### Where it starts (within the chrome budget)

| Surface                                           | Today                                                | Change                                                                     | Count after                       |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| Trace card (secondary action)                     | Sequence diagram (primary), close                    | **Slow motion** button (secondary, icon + word)                            | 2 actions + close                 |
| Node right-click (live)                           | 7 items incl. "Trace next message from here"         | **"Watch next message in slow motion"** right after it                     | 8 (≤ 12)                          |
| Trace a message ▸ (canvas right-click, ⋯, Ctrl+K) | Next message, Slowest so far, One that dead-lettered | **Next message, in slow motion** as the first row                          | 4 rows, top-level count unchanged |
| Palette                                           | Trace a message drill + 3                            | Same row in the drill, plus "Slow motion: replay this trace" while tracing | —                                 |
| Timeline step (authoring)                         | `{ do: "trace", node }`                              | Optional `slowMotion: true`, so a narrated presentation can include one    | —                                 |

Top bar and control bar: **no new controls**. Vocabulary: **Slow motion** (noun and mode), and
**Watch … in slow motion** on menus. Add it to `docs/UX-PRINCIPLES.md` next to Trace a message: a slow
motion is a paced _replay_ of a trace, so it's always reached from the trace.

#### Record first, then replay (how it fits the engine)

1. Capture a checkpoint (`runner.checkpoint()`, or `engine.checkpoint()` in free play).
2. Request the trace (`tracer.request({ next: "message", node })`, or `followRoot` for a clicked or
   historical message). Advance the engine in **cancellable slices** (the existing replay slicing:
   at most 200 ticks or about 6 ms per frame). Stop when `tracer.current().done`, at a **30 s
   simulated** look-ahead cap, or when nothing can ever arrive (free play with traffic off: show the
   existing "Send one now"). Pausing notes are passed over the way `seek` passes them.
3. Copy `tracer.current()`, **restore the checkpoint**, and keep following the same root.
4. Build a **script** from the journey (below) and play it on its own clock. The engine stays paused.

Why replay and not slow the live engine: the dwell, easing and fan-out sync above can't be added to
live timing without changing results. A replay of a deterministic run is exactly what will happen.
After Esc, playing live shows the same message take the same path at real speed. "Slowest so far" and
"One that dead-lettered" already have recorded journeys, so they need no look-ahead. A message clicked
mid-flight replays from its history (`partial` if it started before recording).

#### Pacing: compressed per hop, not proportional

Real timing would make a 40 ms write invisible next to a 300 ms hop, and a 4 s queue wait would
swallow the clip. Every lineage event becomes a **beat** with its own duration. Branches run in
parallel; a beat starts when its parent beat ends. Real numbers always appear as **text** (captions,
and the trace card's hop list), so the motion stays readable and the numbers stay honest. Dwell times
grow with the logarithm of the real duration, so order is preserved: a slower step always pauses
longer.

| Beat                       | From lineage                                    | Wall duration                                                                                                  | Motion and easing                                                                                                                        | Caption (real units)                                                                                                                              |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Establish                  | `emit`                                          | 0.8 s hold                                                                                                     | Source node glows                                                                                                                        | "Storefront sends OrderRequest"                                                                                                                   |
| Lift-off (anticipation)    | start of each `send`                            | 150 ms, included in travel                                                                                     | Dot grows 0→1 at the node border; the edge brightens                                                                                     | —                                                                                                                                                 |
| **Travel**                 | `send` → `arrive`                               | `clamp(L / 260 px/s, 0.9 s, 1.8 s)`, where L = on-screen edge length at the slow-motion zoom                   | **easeInOutCubic** (d3 `easeCubicInOut`): mean 260 px/s ≈ 6°/s, peak ≈ 390 px/s ≈ 9°/s. A 40 px trail.                                   | Edge label shown in full strength (e.g. "Authorize payment")                                                                                      |
| Landing                    | `arrive`                                        | 250 ms, included in travel                                                                                     | The existing arrival ring                                                                                                                | —                                                                                                                                                 |
| **Processing**             | `start` → `done`                                | `clamp(0.55 + 0.22·log2(1 + ms/25), 0.6, 1.6)` s: 40 ms → 0.85 s, 70 ms → 0.97 s, 180 ms → 1.22 s, 1 s → 1.6 s | Dot sits inside the node; a progress ring around the node fills **linearly**                                                             | "Payments service · Authorize payment · 150 ms" (the node label + the incoming edge's label + real ms). A rename appears as "→ PaymentCompleted". |
| **Waiting** (backlog, lag) | gap between `arrive` and `start` > 20 ms        | `clamp(0.5 + 0.3·log2(1 + ms/100), 0.5, 2.0)` s                                                                | The dot joins a small **stack** on the broker or node (Mini Metro style), then leaves it                                                 | "waited 4.2 s · 312 ahead" (backlog read from the trace step)                                                                                     |
| Broker append              | arrive at a topic, stream or queue with no wait | 0.45 s                                                                                                         | The dot settles into the log tick marks under the node                                                                                   | "appended to orders.created.v1"                                                                                                                   |
| **Split** (fan-out)        | `copy` steps at one node                        | 0.4 s                                                                                                          | Copies appear stacked on the node, then **depart together** on a shared duration (the longest of their travels): common fate, no stagger | One label per copy, at most 4 labelled. More than 4 get one group pill: "×6 OrderPlaced".                                                         |
| **Write**                  | arrival at a `store`                            | Processing beat for the store, plus a 300 ms sink                                                              | The dot shrinks to 30% and fades _into_ the cylinder; the node's top edge flashes in the message colour (not red)                        | "Orders database · write OrderPlaced · 40 ms"                                                                                                     |
| Sync reply                 | `send` with `via: "reply"`                      | 0.6 × travel, **doesn't block** the next beat                                                                  | Small dot at 55% alpha, no label                                                                                                         | —                                                                                                                                                 |
| Retry                      | `fail`, `retry`                                 | 1st and 2nd: full travel back (amber). Later ones collapse into one 1.2 s beat.                                | Amber, ↺                                                                                                                                 | "failed · retry 2 of 3" or "↺ retried 5× over 3.1 s"                                                                                              |
| Dead letter                | `deadletter`                                    | travel × 1.2                                                                                                   | Red, a slightly larger dot                                                                                                               | "Dead-lettered after 3 attempts"                                                                                                                  |
| Drop                       | `drop`                                          | 0.6 s                                                                                                          | Fade out with a node flash                                                                                                               | "Dropped · consumer down"                                                                                                                         |
| End                        | the trace is done                               | 1.2 s hold                                                                                                     | Visited nodes keep a tick with their real offset ("+0.43 s")                                                                             | "Done · 2.42 s · 6 copies · 5 writes"                                                                                                             |

Kafka order estimate: 0.8 + 7 hops on the longest chain (about 1.0–1.3 s each) + 6 pauses (0.85–1.22 s)

- 2 splits + 2 appends + 1.2 ≈ **17 s**; with sync replies and the write sinks, **about 17–20 s**.
  At most **4 dots move at once** (the 5.04–5.29 s window), which is within tracking capacity at these
  speeds. The control bar's speed select scales slow motion pacing while it's on (1× is the pace above,
  0.5× is twice as long, 2× is quicker for rehearsals), so the select gets one more job, not a new
  control.

**Reduced motion.** No travel animation and no camera moves. Each beat is a discrete state (the dot
cross-fades to its next position over 200 ms), held for 1.5 s on autoplay. This is Packet Tracer's
event stepping and needs no extra design.

#### Camera

- **Default: show the whole path, still.** At the start, fit the union of the journey's nodes (known
  in advance because we recorded first) with `NOTE_FIT` (900 ms ease, `maxZoom 1.25`, padding clear of
  the trace card). Then the camera **doesn't move**. A still camera keeps the topology readable, avoids
  two moving things at once, and makes recordings clean.
- **Follow only when the path doesn't fit legibly.** If the fitted zoom is below 0.55 (labels under
  about 11 px; design review round 5 found 41% unreadable), switch to following. Frame the current
  frontier (nodes of the beats in progress plus their targets) at zoom ≥ 0.8. **Pan only during
  pauses**, never during travel: a 700 ms easeInOutCubic pan while the dot is still. Fan-out frames
  all copies' targets; if they can't fit at 0.8, frame the longest branch and keep the others' labels
  at the screen edge.
- If the user pans or zooms during slow motion, stop following until Replay (the same as narration).

#### What else is on screen

- **Background traffic is frozen and dimmed.** The engine is paused at the moment slow motion started.
  Background dots are drawn at **12% alpha**, with no trails, pulses or failure flashes. Nodes and edges
  off the path use the existing narration dim (35%). Edges on the path are at full strength, with
  their labels.
- **Badges and counters** (throughput, lag, replicas) are frozen at that moment, at 40% opacity off the
  path. Nodes on the path show their real time offset chip as they're visited. The control bar's clock
  shows **journey time in real units**: "0.43 s / 2.42 s real" (`data-testid="live-clock"` with
  `data-mode="slowmo"`).
- **Scale.** With scale > 1, the traced dot stands for many messages. The card's footer says "Each dot
  stands for 50 messages; this is one of them." Captions talk about _one_ message.
- **Leaving** (Esc, or the Live trace's close): restore the paused or playing state from before. The
  engine is exactly where it was, and the trace stays on so the real-speed run shows the same message.

#### Controls: reuse the trace card and the control bar

| Control            | In slow motion                                                                                                        | Notes                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Play/Pause (Space) | Plays or pauses the replay                                                                                            | `data-state="slowmo"` on `live-play`                                                                |
| Restart button     | **Replay** from the start                                                                                             | Same button, same place                                                                             |
| Timeline           | Shows **beats as ticks** (hops, with pauses as spans), scrub to any beat                                              | Reuses `Timeline` with replay markers. The simulation's own markers are hidden while it's on.       |
| → / ←              | **Next hop** / previous hop: jump to the start of the next beat and pause                                             | Packet Tracer's Capture/Forward. The ⋯ menu's "Step ¼ second" row becomes "Next hop" while it's on. |
| Trace card         | Highlights the current hop row (`aria-current`); **clicking a row seeks** there; the Slow motion button becomes Pause | The card is the event list                                                                          |
| Speed select       | Pacing multiplier (above)                                                                                             | —                                                                                                   |
| Esc                | Ends slow motion and returns to the trace                                                                             | Fits "Esc backs out one level"                                                                      |

#### Recording

While slow motion is on, **Record video…** offers one option, like a simulation: **"Record this slow
motion."** After the 3-2-1 countdown, the replay restarts at beat 0 and recording stops after the end
hold. It uses presentation view (already enforced), crops to the diagram, and is named
`<diagram>-<type>-slow-motion.webm`. A 17–20 s clip suits Slack and slides. The journey fit is chosen
before the countdown, so the video never opens with a camera move.

### B. Calmer slow speeds (a renderer default, no new control)

Below 1×, draw **whole journeys of a sample of messages**, so 0.25× answers "I want to see things flow"
without slow motion:

- **Rule.** `k = 2^round(log2(max(1, sampledParticles / D)))`, with **D = 24** dots at 0.25× and **D = 48**
  at 0.5×. At 1× and above nothing changes, and the existing `densityStride` stays as the fallback. A
  particle is drawn when `hash(rootId) % k === 0`, so a message is either visible on every hop or on
  none. The traced family is always drawn.
- **Stability.** Recompute at most once a second, and only change k by one doubling or halving per
  step (hysteresis ±25%). Newly visible dots fade in over 200 ms.
- **Expected effect** (from the measurements):

| Run at 0.25×          |  Drawn now   |  k  |  Drawn after   | Busiest edge, dots/s after |
| --------------------- | :----------: | :-: | :------------: | :------------------------: |
| Kafka free play       |     113      | 4–8 |  **≈ 16–30**   |          ≈ 3.5–7           |
| Kafka Black Friday    |     126      |  8  |    **≈ 25**    |  ≈ 5 (typical edge ≈ 2.8)  |
| Kafka payments outage |     165      |  8  |    **≈ 30**    |    ≈ 6 (typical ≈ 3.4)     |
| AWS spike             | 48 (105 max) |  4  |  **≈ 12–26**   |            ≈ 6             |
| IoT morning           |      11      |  1  | 11 (unchanged) |            9.9             |

- **Counters stay exact.** Thinning is a drawing limit, which the engine contract already allows
  ("Drawing limits never affect message delivery"). The speed select's tooltip says: "Slower speeds
  draw fewer dots so each one is easy to follow; counts stay exact." `scale` and "1 dot = N" are
  unchanged: thinning is visual, like today's `densityStride`. Expectations, recording and capacity
  don't change.

### Defaults

- Live opens at **1×**, as now. For a presentation, the recommended flow is: pick the simulation, then
  "Next message, in slow motion" at the narration point (or the `slowMotion` trace step).
- Keep the speed select as six numbers (0.25×–8×). No named steps, no continuous slider: Slow motion
  is the "watch" idea, and speed stays about time.

### Implementation sketch

| File                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/trace/slowMotion.ts` (new, pure)         | `buildScript(trace, diagram, geometry, pacing) → Beat[]`. Each beat has `{ kind, ids, node?, edge?, start, duration, realMs, caption, parent }`. `frameAt(script, t)` returns moving dots `{ id, edgeId, kind, color, type, progress (eased) }`, active nodes and their ring progress, captions, visited offsets, and the camera frontier. Pacing constants live in one exported object. Unit-tested: clamps, log-dwell ordering, splits sharing a duration, waits, retry collapsing, non-blocking replies, reduced-motion beats. |
| `src/live/controller.ts`                      | `watch(request)`: checkpoint → sliced look-ahead (reusing `replay` slicing) → copy the journey → restore → `slowMotion` state `{ script, t, playing, from }`. Plus `playSlowMotion`, `pauseSlowMotion`, `stepBeat(±1)`, `seekSlowMotion(ms)`, `endSlowMotion()`. While it's on, `advance()` does nothing. Test: the engine snapshot is byte-identical before and after `watch()`.                                                                                                                                                 |
| `src/live/particleRenderer.ts`                | `draw(snap, now, focus, overlay?)`: with an overlay, background heads are drawn at 0.12 alpha with no trails or pulses, then overlay dots (focus styling, `placeTraceLabels`), the node progress ring, the write sink, the split stack and the group pill. Part B: family-hash thinning below 1× (`speed` passed in `RenderOptions`). Exposes `canvas.dataset.slowmoBeat` and the existing `data-trace-labels` for tests.                                                                                                         |
| `src/live/LiveView.tsx`                       | Drives the slow-motion clock from rAF, applies the camera rules (fit, then follow only during pauses), applies the narration dim to off-path nodes and edges.                                                                                                                                                                                                                                                                                                                                                                     |
| `src/live/TraceCard.tsx`                      | **Slow motion** button (`data-testid="trace-slowmo"`), current row (`aria-current`, `data-testid="trace-row-current"`), click a row to seek.                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/live/ControlBar.tsx`, `Timeline.tsx`     | Mode-aware play, restart, clock and timeline (beat markers). Speed acts as the pacing multiplier.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/live/liveActions.ts`                     | Node: "Watch next message in slow motion". Trace a message ▸: "Next message, in slow motion". The palette rows.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/live/record/recordModel.ts`              | A slow-motion source: restart the replay after the countdown, stop after the end hold.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/model/types.ts`, `src/sim/simulation.ts` | Optional `slowMotion?: boolean` on the `trace` timeline action. The runner raises it to the controller.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Docs                                          | `docs/SIMULATION.md` (the slow-motion and thinning contract), `docs/UX-PRINCIPLES.md` (the vocabulary entry). After building, run the UX gate round in `docs/DESIGN-REVIEW.md`.                                                                                                                                                                                                                                                                                                                                                   |
| Tests                                         | Unit tests as above. Playwright (data-testid selectors only): Kafka → node right-click → Watch… → assert `live-play[data-state=slowmo]`, captions in order, at most 4 moving dots per `data-slowmo-beat`, Esc restores the engine time; reduced-motion variant; layout audit for caption overlap (`tests/e2e/layout.spec.ts`).                                                                                                                                                                                                    |

### Risks

1. **Look-ahead that never ends**, e.g. a consumer down or a huge lag. Cap at 30 s simulated, then play
   what was recorded. End on "Still waiting at Payments service · lag 1,240" instead of Done. The cost
   is bounded by slicing; the controller already does this for scrubbing.
2. **Long journeys** (retry storms, feedback cycles, 600-step truncation). Collapse retries after the
   2nd. Show cycles once with a "↻ ×N" chip. Warn when the script would run over 60 s.
3. **Wide fan-out** (more than 4 copies at once, e.g. SNS → many queues) goes past tracking capacity.
   Keep common fate and one group label. If it proves confusing, a later option is "branch by branch".
4. **Timing honesty.** Compressed pacing distorts relative durations. Mitigations: log-ordered pauses,
   real ms in every caption, true numbers in the trace card and sequence diagram, and the clock in real
   time. Don't add a "proportional" toggle (chrome budget); revisit only if users ask.
5. **"Why did live stop?"** Freezing could look broken. The play button state, the clock's
   "real" label, a 35% dim, and the card saying "Slow motion · live is paused" make it explicit. Esc
   returns.
6. **Thinning (B) hides activity** (a rare DLQ dot could be sampled out). Never thin `dlq` or `retry`
   kinds, and keep failure flashes and counters unthinned.
7. **Caption and label overlap** with node cards and badges (principle 10). Reuse `placeTraceLabels`
   with captions as hard obstacles, and extend the overlap audit.
8. **Cost.** A checkpoint plus a look-ahead per watch: fine for the public examples (a 2.4 s journey is
   240 ticks). Large private-scale diagrams should be profiled before release.

## 6. Alternatives, ranked

1. **Recommended: slow-motion replay plus calmer drawing below 1× (A + B).** It covers the owner's
   headline scenario completely, and B fixes general viewing at slow speeds. It's one new concept,
   and the live engine's timing stays untouched.
2. **Live follow at slow speed**: trace + automatic 0.25× + camera follow + B's thinning, with no
   replay. It's cheap, because most of it exists. But the timing stays proportional: a 40 ms write is
   0.16 s on screen, and there are no pauses, no synchronised splits and no per-hop stepping. Other
   traffic keeps moving and capturing attention, and recordings show unrelated motion. About 60% of
   the value.
3. **Event stepping on the live engine** (Packet Tracer's Capture/Forward): a "Next hop" control that
   runs the engine until the traced family's next lineage step. It's honest and simple, but nothing
   moves smoothly (it jumps), and every other dot jumps too. It's a better fit as the step control
   inside slow motion (A) than as a feature of its own.

Not recommended: extra slow speeds (0.1×, 0.05×), a story mode that injects synthetic traffic, and ×N
bundle pills (for later, at high speeds).

## Sources

- Pylyshyn & Storm, MOT overview: https://en.wikipedia.org/wiki/Multiple_object_tracking
- Alvarez & Franconeri 2007, _How many objects can you track?_: https://visualcognition.psych.northwestern.edu/publications/AlvarezTracking2007.pdf
- Franconeri et al. 2010, speed vs. crowding: https://visualcognition.psych.northwestern.edu/publications/FranconeriPsychSci2010.pdf
- Abrams & Christ 2003, _Motion onset captures attention_: https://pubmed.ncbi.nlm.nih.gov/12930472/ ; Guo et al. 2010: https://link.springer.com/article/10.3758/APP.72.5.1311
- Simons & Rensink 2005, _Change blindness: past, present, and future_: https://www.cs.ubc.ca/~rensink/publications/download/S&R-TICS-05a.pdf
- Smooth pursuit gain: https://pmc.ncbi.nlm.nih.gov/articles/PMC1190396 ; https://iris.unipv.it/handle/11571/454225
- Heer & Robertson 2007, _Animated Transitions in Statistical Data Graphics_: https://homes.cs.washington.edu/~jheer/files/2007-AnimatedTrans-InfoVis.pdf ; principles summary: https://courses.cs.washington.edu/courses/cse442/24au/lectures/CSE442-Animation.pdf
- Dragicevic et al. 2011, _Temporal Distortion for Animated Transitions_: https://cs.au.dk/~elm/pdf/timedistort.pdf
- Chevalier, Dragicevic & Franconeri 2014, staggered transitions: https://visualcognition.psych.northwestern.edu/publications/ChevalierDragicevicFranconeri2014.pdf
- Tversky, Morrison & Bétrancourt 2002, _Animation: can it facilitate?_: https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf
- Mayer, segmenting principle: https://www.cambridge.org/core/books/multimedia-learning/segmenting-principle/37240877DDA0362355ADB39936027982 ; review: https://link.springer.com/article/10.1007/s10758-024-09745-2
- Cisco Packet Tracer Simulation mode: https://tutorials.ptnetacad.net/help/default/mode_simulation.htm
- Kiali topology (density = rate, speed = response time): https://v1-82.kiali.io/docs/features/topology
- IcePanel Flows: https://docs.icepanel.io/features/flows
- SoftwareMill Kafka visualisation: https://softwaremill.com/kafka-visualisation ; Aiven: https://aiven.io/tools/kafka-visualization
- Factorio belt physics: https://wiki.factorio.com/Transport_belts/Physics
- Mini Metro visual design: https://mechanicsofmagic.com/2023/04/22/visual-design-of-games-mini-metro/
- VisuAlgo: https://visualgo.net/ ; review: https://www.thedailystar.net/shout/website-review/mastering-algorithms-1240150
- Bret Victor, _Up and Down the Ladder of Abstraction_: http://worrydream.com/LadderOfAbstraction/
- Nicky Case on explorable explanations: https://datastori.es/103-explorable-explanations-with-nicky-case/
