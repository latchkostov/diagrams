# Autoscaling: resources, replica lifecycle and planning

Status: research and proposed design, checked **2026-10-14**. Docs only; no simulation behaviour changes.
Branch `research/autoscaling`, from `origin/master` at `ca4182399e3794a083e2271cb1690ce98b8aa392`.

## Recommendation and scope

Model each compute replica with a CPU cost per message, baseline memory and memory per in-flight message.
Attach one optional autoscaling policy to its node. The controller changes a desired count; only replicas
that have finished starting can accept work. Keep fixed replicas as the default. Offer an HPA service preset
first, KEDA broker presets next, then explicitly approximate cloud controllers. Resource costs are workload
assumptions to measure, never facts inferred from “.NET” or “Java”. A .NET or Java stencil inside Kubernetes
can use exactly the same HPA or KEDA policy.

This fills the processor gap (“Autoscaling, cold starts, per-request CPU”) in
[`planning-model.md` §1.1](planning-model.md#11-what-the-simulation-models-per-role), alongside its §1.4 gaps
and P1–P12 sequence. It extends P1 profiles/explanations and P2 broker allocation. It composes with **P3,
which is in flight**, without implementing another serverless concurrency allocator, quota ledger or
external API admission path. The request/reply approval gate from
[`sim-flows-review.md` item 10](sim-flows-review.md#top-10-recommendations) stays separate: this design does
not make callers wait for replies or introduce outbound deadlines/retry storms.

Read against the merged implementation, rather than assuming the older research is current:

- `src/stencils/profiles.ts` maps families and evidence; `src/sim/defaults.ts` applies family/preset/override
  precedence. Today it clamps resolved replicas to at least one.
- `allocateGroupReplicas` in `src/sim/topology.ts` and its engine consumers enforce P2 partition assignment;
  non-partitioned subscriptions use the shared fleet. `activeReplicas` means assigned, not busy.
- `src/sim/capacity.ts`, `capacityPlanning.ts` and `src/planning/explanation.ts` share configured sizing.
  They currently size a fixed fleet; observed lag is a separate input to the existing trouble watcher.
- `src/interop/infra/kubernetes.ts`, around its KEDA/HPA section, records scale ranges as diagnostics and
  sometimes raises the fixed replica floor. KEDA triggers also infer broker routes. It does **not** persist
  a working autoscaler, resource targets or behaviour policies. ScaledJob diagnostics are not job execution.
- [`SIMULATION.md`](../SIMULATION.md) defines simulation-time ticks, checkpoints, real versus sampled units,
  bounded replay, and legacy/p1/p2 playback preservation. Those contracts continue to apply.

No backend, metrics-server connection, cloud API calls, credentials, live cluster discovery or new endpoint
is needed. All controller metrics come from the local simulation or an explicitly authored metric trace.

## 1. Resource model per compute node

### Units and the small default

Store CPU in **millicores** for requests/limits and **CPU-ms per real message** for work. 1,000 CPU-ms is one
CPU-second, not one second of elapsed request latency. Memory uses MiB (2²⁰ bytes), distinct from the existing
`messageKB` payload field. A useful starting workload might take 250 ms elapsed time but use only 40 CPU-ms:
most of that request could be waiting on I/O. Never add CPU-ms to `latencyMs` a second time.

| Setting                      | Meaning                                                               | Proposed service lesson (assumption, not a runtime benchmark) |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| CPU per message              | CPU actually required by one processing attempt                       | 40 CPU-ms                                                     |
| Baseline memory              | Resident memory while one replica is running, including idle replicas | 128 MiB                                                       |
| Memory per in-flight message | Additional resident memory while processing one real message          | 2 MiB                                                         |
| CPU request / limit          | HPA utilisation denominator / execution ceiling                       | 500m / 1,000m                                                 |
| Memory request / limit       | HPA utilisation denominator / reported OOM risk threshold             | 256 / 512 MiB                                                 |
| Startup / termination grace  | Time before readiness / bounded drain grace                           | 5 s assumed / 30 s Kubernetes default                         |

Requests are **not** resource ceilings. Kubernetes schedules using requests; CPU limits throttle and memory
limits can cause OOM kills. When only a limit is provided, Kubernetes can default its request from that limit;
namespace admission can change the effective values. Import known effective values with provenance; otherwise
say requests are missing. No cluster packing or shared-host contention is implied by this resource model.
[Kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)

Family presets are versioned lessons with evidence `assumption`, selectable without entering six quantities:

| P1 family / workload                             |                                      CPU-ms/message | Baseline + MiB/in-flight | Request CPU / memory | Limit CPU / memory     |
| ------------------------------------------------ | --------------------------------------------------: | ------------------------ | -------------------- | ---------------------- |
| `service`, I/O service (default resource lesson) |                                                  40 | 128 + 2                  | 500m / 256 MiB       | 1,000m / 512 MiB       |
| `service`, CPU worker                            |                                                 200 | 128 + 2                  | 1,000m / 256 MiB     | 1,000m / 512 MiB       |
| `workflow`, orchestration worker                 |                                                  10 | 256 + 4                  | 500m / 512 MiB       | 1,000m / 1,024 MiB     |
| `stream-processor`, transform worker             |                                                  50 | 256 + 8                  | 1,000m / 512 MiB     | 2,000m / 1,024 MiB     |
| `serverless`                                     | Optional measured CPU cost; no invented pod request | P3 instance profile      | P3 allocation        | P3/provider allocation |

These presets do not change existing concurrency or latency on upgrade. The same service can serve HTTP and
consume messages: both spend its one resource pool. Stores, brokers, gateways, SaaS APIs and infrastructure
boundaries do not silently become autoscalable compute. Cluster-node autoscaling is a later, separate model.
The HPA service lesson explicitly selects CPU target 70%, min 1 and max 10 (product assumptions); the official
omitted-metric target remains 80%. With the existing 4 slots / 250 ms workload, 40 CPU-ms/message can exceed
the chosen CPU target before slots saturate. Do not ship an I/O lesson whose CPU never reaches its target
under load without explaining that CPU HPA cannot resolve its slot bottleneck.

### Resource accounting and throughput

For replica `i` over a measurement window of `W` simulated milliseconds:

```text
usedCores_i       = executedCpuMs_i / W
cpuRequestPct_i   = 100 × usedCores_i / (cpuRequestMilli / 1000)
cpuLimitPct_i     = 100 × usedCores_i / (cpuLimitMilli / 1000)   [if known]
memoryMiB_i(t)   = baselineMiB + realInFlight_i(t) × memoryMiBPerMessage
memoryRequestPct = 100 × memoryMiB_i / memoryRequestMiB
memoryLimitPct   = 100 × memoryMiB_i / memoryLimitMiB             [if known]
```

CPU can exceed 100% **of request** while staying below its limit. A missing request means utilisation of
request is unavailable, not zero; absolute CPU/memory targets can still work. HPA uses valid per-pod samples,
including ready idle pods. Show memory as the latest working-set estimate; smoothing/window semantics belong
to the selected metric adapter. Exclude node backlog from in-flight memory in this first model, and explicitly
state that queued payloads, caches, GC, sidecars and startup CPU spikes are not estimated.

**Proposed execution rule:** retain the existing elapsed service-time clock and add remaining CPU work to each
active attempt. Progress elapsed time and CPU work together. Distribute a replica's finite CPU budget fairly
over its active attempts, in stable order; work finishes only when both requirements are met. Thus concurrent
I/O can overlap, CPU is capped without adding it to latency, and saturated CPU extends completion time. With
no CPU limit, use an explicit assumed available CPU from the preset; never treat a Kubernetes request as a
hard ceiling. Imported unlimited CPU with no available-CPU assumption remains an unbounded CPU estimate,
labelled as such. No new CPU accounting applies when resources are absent. Charge each executed retry attempt;
backoff and broker waiting consume no per-message CPU in this approximation.

For homogeneous ready replicas, the sustainable per-replica estimate is:

```text
slotCapacity = concurrency × 1000 / latencyMs
cpuCapacity  = availableCores × 1000 / cpuMsPerMessage
capacity     = min(slotCapacity, cpuCapacity, P3/applicable admission constraints)
```

Zero CPU cost removes the CPU term; zero elapsed latency keeps existing tick pacing in playback, and the
planner must disclose that discretisation. This is a pooled CPU model: thread affinity and a single-thread
bottleneck on a multi-core process need measured capacity rather than a claim that all cores are usable.

**Memory limits in A1 are risk checks, not a new admission/retry policy.** Display “Memory limit exceeded;
OOM/restart not simulated”, flag the run as unsafe, and do not claim a healthy deployable outcome. Do not
quietly cap memory or queue work as if Kubernetes did that. Memory HPA still observes the estimate and can
scale, but constant baseline memory cannot be diluted away by replicas. Planner feasibility also reports
`baseline + concurrency × perMessage > limit`; automatic OOM/restart and GC modelling are deferred.

### Sampling and live readouts

All resource accounting uses **real-message work**. A dot representing `s` messages charges `s × CPU-ms`,
while service duration stays per-message and the existing sampled service budget still applies. Maintain
weighted occupancy credits for memory; do not put all `s` messages on one physical replica and invent an OOM.
For large samples, distribute the represented work over identical eligible replica cohorts, respecting their
aggregate concurrency. CPU credits must be bounded to one scheduling quantum plus residual fractional work,
so an idle service cannot bank unlimited CPU. Sampling must not multiply throughput or resource work twice.

At scale 1, track exact active replica identities; at larger sampling scales, per-replica values within an
identical cohort are estimates and must say so. Use time-integrated occupancy rather than instantaneous dot
count for sampled memory. Resource windows operate on consumed work, not rendered particles or throughput
EWMA. Show both `CPU 92% of request` and `Memory 54% of limit` with named denominators, a per-replica list on
selection, and a desired/starting/ready/draining count over simulation time. Never relabel existing slot
utilisation as measured CPU.

## 2. Real controller behaviour and defaults

Verification: official sources below were checked on 2026-10-14. **KEDA references are deliberately pinned
to documented v2.18 semantics**, not a claim that 2.18 is the latest release. Imported versions outside the
implemented profile must be identified. Kubernetes controller flags can differ by cluster; published defaults
are a preset, not evidence about an imported cluster. Values labelled **UNVERIFIED** must not become vendor
defaults. Values labelled **assumption** are an explicit design choice. Tables and prose describe the same
defaults; startup, scheduling and metric-delivery delays are additional to controller intervals.

### Defaults and reaction table

| Scaler                                | Inputs / target                                                                         | Official defaults                                                                                                                                                            | Reaction delays                                                                                    | Limits / qualifications                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes HPA v2                     | CPU/memory as % of requests or absolute values; Pods/Object/custom/External metrics     | Missing metrics list: CPU 80%; min 1; max required. Sync 15 s; tolerance 10%. Up window 0 s, max of +4 pods or +100% per 15 s; down window 300 s, remove up to 100% per 15 s | Metric freshness + next sync + readiness/startup; down uses rolling recommendation history         | Maximum is configuration, not a cluster capacity guarantee. Ordinary CPU/memory HPA cannot activate from zero. [API](https://kubernetes.io/docs/reference/kubernetes-api/autoscaling/horizontal-pod-autoscaler-v2/), [controller flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/), [behaviour](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/#default-behavior)           |
| KEDA ScaledObject                     | Trigger metric; separate activation threshold                                           | Poll 30 s; cooldown to zero 300 s; initial cooldown 0 s; min 0, max 100; trigger cache off                                                                                   | 0→1 activation on poll; 1→N through HPA (normally 15 s); cooldown only governs final scale to zero | Needs a trigger observable at zero; `idleReplicaCount` omitted, only 0 supported when supplied. [ScaledObject](https://keda.sh/docs/2.18/reference/scaledobject-spec/)                                                                                                                                                                                                                                                                                           |
| KEDA ScaledJob                        | Queue metric, target/batch, unfinished/pending jobs                                     | Poll 30 s; min 0, max 100; strategy `default`; multiple scaler calculation `max`                                                                                             | Poll + job startup; jobs finish rather than HPA scale down                                         | No ScaledObject cooldown or HPA behaviour. Accounts for unfinished jobs; job parallelism is not service replicas. [ScaledJob](https://keda.sh/docs/2.18/reference/scaledjob-spec/)                                                                                                                                                                                                                                                                               |
| ECS target tracking                   | `ECSServiceAverageCPUUtilization`; `ALBRequestCountPerTarget` in requests/target/minute | Target and min/max explicitly configured; scale-in/out cooldown 300 s                                                                                                        | CPU metrics normally 60 s; optional high-resolution CPU/memory 20 s; managed alarms + task startup | ALB target is not concurrent requests; insufficient data is not low load. CPU-only cannot wake zero tasks. [policy](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/target-tracking-create-policy.html), [cooldowns](https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html), [resolution](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/target-tracking-faster-auto-scaling.html) |
| Azure Container Apps                  | HTTP concurrent requests or KEDA event rules                                            | HTTP threshold 10, default range 0–10; custom-event poll 30 s, cooldown 300 s; down stabilization 300 s                                                                      | HTTP documented calculation every 15 s; event poll does not apply to HTTP/TCP; startup extra       | CPU/memory-only rules cannot wake zero. Jobs use event-driven job semantics. [ACA scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)                                                                                                                                                                                                                                                                                                     |
| Azure App Service / Monitor autoscale | Metric threshold/window/action, or scheduled profile, applied to the plan               | Cooldown 5 min; target, aggregation window and min/default/max are authored                                                                                                  | Evaluation every 30–60 s, metric window + provisioning                                             | SKU limits; shared plan scales its apps together. Separate traffic-based “automatic scaling” is a different product feature. [settings](https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-understanding-settings), [cooldown](https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-get-started), [distinction](https://learn.microsoft.com/en-us/azure/app-service/manage-automatic-scaling)                        |
| Google Cloud Run                      | CPU + request concurrency + on-demand request pressure                                  | CPU/concurrency targets 60%; concurrency 80 in console, 80 × vCPU for new CLI/Terraform services (max 1,000); min 0; revision max 100                                        | CPU 1-min average; concurrency 1/10-min windows; on-demand activation and startup                  | No memory scaling. Service/revision limits compose; maximum may briefly be exceeded in reality. [autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling), [concurrency](https://docs.cloud.google.com/run/docs/about-concurrency), [minimum](https://docs.cloud.google.com/run/docs/configuring/min-instances), [maximum](https://docs.cloud.google.com/run/docs/configuring/max-instances)                                              |
| Azure Functions                       | Trigger demand + per-instance concurrency, plan-dependent                               | No universal instance/concurrency defaults: select hosting plan and trigger                                                                                                  | Scale controller + trigger polling + cold start, plan-dependent                                    | P3 owns concurrency/allocation. Dedicated hosting uses App Service scaling. [concurrency](https://learn.microsoft.com/en-us/azure/azure-functions/functions-concurrency), [hosting](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)                                                                                                                                                                                                     |
| AWS Lambda                            | Concurrent executions, account/function/event-source allocation                         | Regional account concurrency commonly 1,000; per-function growth up to 1,000 environments per 10 s                                                                           | Demand-driven growth + cold initialization; no HPA poll                                            | Account quotas can differ. Reserved concurrency caps allocation; provisioned concurrency supplies warm environments. [concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html), [scaling](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html)                                                                                                                                                                          |
| Azure VM scale sets                   | Azure Monitor CPU/queue/custom metric rules and schedules                               | Rule cooldown 5 min; thresholds, min/default/max authored                                                                                                                    | Monitor evaluation 30–60 s + window + VM provisioning                                              | Limits depend on image/orchestration; do not reuse pod counts as host capacity. [VMSS](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-autoscale-overview), [Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-understanding-settings)                                                                                                                                            |
| AWS EC2 ASG                           | CPU, ALB requests/target, custom target/step/simple policies                            | Simple-policy cooldown 300 s; target tracking uses instance warmup, with fallback to default cooldown when unset                                                             | Metric/alarm interval + launch/warmup; EC2 basic metrics 5 min, detailed 1 min                     | Min/desired/max and quotas authored. A 300 s cooldown is not a blanket pause for target-tracking scale-out. [cooldowns](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-scaling-cooldowns.html), [warmup](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-default-instance-warmup.html), [target tracking](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html)                  |

### HPA details to preserve

Use the largest metric recommendation, approximately `ceil(currentReplicas × currentMetric / target)`.
For resource utilisation, average valid per-pod utilisation of **requests**, not limits; Pods metrics average
per pod, while Object/External can use a total `Value` or per-replica `AverageValue`. Missing/error metrics
must inhibit unsafe scale-down; another valid metric can still require scale-up. Startup/missing pod samples
are treated conservatively rather than simply averaging them as idle. Stabilization uses recommendation
history, and rolling rate policies count actual changes in their period; neither is a sleep after each event.
[HPA algorithm](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/#algorithm-details)

Cluster defaults are 30 s initial-readiness delay and 300 s CPU-initialization period. They filter unsuitable
CPU samples, **not** mandatory waits before a ready pod can serve or contribute valid metrics. Startup and
readiness probes determine when traffic can enter. Limits do not replace missing resource requests.
[Controller flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/)

Support Resource and single-container ContainerResource targets first. Multi-container imports must retain
the container selector; do not collapse its target to total pod utilisation. Generic custom/External metrics
need a local metric binding, not an invented metric-server response. Per-direction tolerance is version/
feature-gate dependent; retain the shared 0.1 default and identify explicit unsupported settings. HPA scale to
zero has feature/metric prerequisites; A1 deliberately supports min ≥ 1 and directs event activation to KEDA.
[HPA API](https://kubernetes.io/docs/reference/kubernetes-api/autoscaling/horizontal-pod-autoscaler-v2/)

### KEDA trigger defaults and metric meaning

| Trigger                              | Scaling target default                                                                                                                   | Activation default          | What to measure locally / important exception                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kafka `kafka`                        | `lagThreshold: 10` total lag per desired consumer                                                                                        | `activationLagThreshold: 0` | Named consumer-group uncommitted lag across selected topic partitions. `allowIdleConsumers: false` caps desired count by partitions; `offsetResetPolicy: latest`; invalid offsets keep a consumer by default. [Kafka](https://keda.sh/docs/2.18/scalers/apache-kafka/)                   |
| Azure Service Bus `azure-servicebus` | `messageCount: 5`                                                                                                                        | `activationMessageCount: 0` | Active messages in queue or named topic subscription, excluding the DLQ. No aggregate across unrelated subscriptions. [Service Bus](https://keda.sh/docs/2.18/scalers/azure-service-bus/)                                                                                                |
| SQS `aws-sqs-queue`                  | `queueLength: 5`                                                                                                                         | `activationQueueLength: 0`  | Visible + not-visible/in-flight by default; `scaleOnInFlight: true`, `scaleOnDelayed: false`. Never add in-flight twice. [SQS](https://keda.sh/docs/2.18/scalers/aws-sqs/)                                                                                                               |
| RabbitMQ `rabbitmq`                  | Modern `mode: QueueLength` + explicit `value`; no documented numeric default for modern `value`. Deprecated `queueLength` defaults to 20 | `activationValue: 0`        | AMQP observes ready messages; HTTP can include unacknowledged, with `excludeUnacknowledged: false`. Choose protocol semantics explicitly. A new lesson can use value 20 as an **assumption**, not a modern vendor default. [RabbitMQ](https://keda.sh/docs/2.18/scalers/rabbitmq-queue/) |

Activation is **strictly greater than** its threshold. With min ≥ 1 it does not gate 1→N scaling. An active
ScaledObject at zero first requests at least one replica (or its configured activation floor), then HPA scales
1→N; do not scale straight from zero using a CPU sample. Multi-trigger activation is any active trigger and
HPA uses the largest desired count. Keep the final-zero cooldown separate from HPA down stabilization; do
not sum the two as a universal 600 s delay. The zero decision can still terminate busy work in reality.
[Activation/scaling phases](https://keda.sh/docs/2.18/concepts/scaling-deployments/#activating-and-scaling-thresholds),
[ScaledObject settings](https://keda.sh/docs/2.18/reference/scaledobject-spec/)

Kafka's default cap is a **controller rule**; partition assignment is independently a **work allocation rule**.
With `allowIdleConsumers: true`, another trigger, or an HPA, replicas beyond available partitions can exist and
sit idle on that input. Never impose a global partition cap on HTTP or P2 subscription processing. Missing
Kafka offset history, unspecified topics and invalid offsets must produce an explicit unsupported/unknown
diagnostic until modelled, rather than “zero lag” and an activation deadlock.
[Kafka edge cases](https://keda.sh/docs/2.18/scalers/apache-kafka/)

ScaledJob creates finite work units. Its default calculation subtracts unfinished running jobs from
`min(maxReplicaCount, ceil(queueMetric / targetAverageValue))`; additions cannot be negative. Pending jobs,
minimum jobs and job parallelism also matter. No HPA downscale or ScaledObject cooldown applies; existing jobs
run to completion. **A2 imports and explains ScaledJob but does not execute it**: a truthful job lifecycle,
batch/completion count and JobSpec parallelism warrant a later scoped implementation. Import diagnostics
must say this instead of enabling a Deployment-style controller on a job node.
[ScaledJob specification](https://keda.sh/docs/2.18/reference/scaledjob-spec/)

### Cloud adapters and the P3 boundary

For ECS, CPU is relative to task-definition CPU, not an inherited Kubernetes request. ALB counts must come
from the simulated load balancer's routed requests, expressed per target per **minute**, not a service's
arbitrary total message input. Multiple target policies scale out when any asks and scale in only when all
enabled policies agree. A CPU metric absent at zero cannot wake tasks. Exact managed alarm evaluation-count
defaults are **UNVERIFIED** here: expose configured alarm windows or label the adapter approximate; do not
present a fabricated three-minute guarantee. Scale-out cooldown can admit a larger necessary increase, while
scale-in cooldown blocks further shrink and does not prevent scale-out.
[ECS policies](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html),
[ECS lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html),
[ECS utilisation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_utilization.html)

Container Apps' HTTP rule is a scaling trigger, not an admission concurrency ceiling. Its documentation
describes a 15 s request-count calculation for “concurrent requests”; preserve that documented distinction
and label a simple active-request occupancy implementation an approximation. Custom event rules share KEDA
activation concepts; no-ingress, min-zero apps need an external event rule to wake. Keep one active revision
in the first adapter; revision traffic splits are deferred.
[Container Apps rules](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)

App Service **autoscale** applies Azure Monitor rules to the plan: CPU, memory, queue/custom metrics, windows,
step actions and min/default/max. It is not an HPA ratio controller, and is not per-app traffic-based
**automatic scaling** (Premium tiers, always-ready/prewarmed instances). Model one app/plan initially; warn
when multiple nodes imply shared plan capacity until an explicit shared pool is supported. Apply any scale-out
rule, require all scale-in rules, and check predicted post-shrink load to avoid flapping. A 70%/30%, five-minute
window, ±1 instance lesson is an **assumption**, not an Azure default.
[Monitor evaluation](https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-understanding-settings),
[automatic scaling distinction](https://learn.microsoft.com/en-us/azure/app-service/manage-automatic-scaling)

Cloud Run uses metrics plus on-demand request activation. The current official description includes CPU
averaging, 1/10-minute concurrency windows, adaptive concurrency tuning, a relative 10% metrics tolerance and
idle instance retention. Memory is not a scaling input. An adapter that implements only CPU/concurrency targets
and request wakeup is **approximate**; fixed controller cadence and exact cold-start duration are
**UNVERIFIED**, not a borrowed 15 s HPA interval. Use 1 vCPU / 80 concurrency / min 0 / revision max 100 as an
explicitly pinned single-revision lesson; respect P3 admission and acknowledge real maximum overshoot.
[Cloud Run controller](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)

Lambda keeps P3's shared regional/function allocation and event-source limits. Reserved concurrency is a
reservation/cap, not a warm replica count; provisioned concurrency is warm capacity, not extra account quota.
CPU/memory can describe a function instance but must not enable HPA for it. Azure Functions must select hosting
plan and trigger: Flex HTTP concurrency defaults are 4/16/32 at provider-labelled 512/2,048/4,096 MB instance
sizes (Python defaults to 1),
whereas event triggers and dynamic concurrency have different rules. Reuse the P3 allocator and its resolved
units; do not duplicate these plan tables in the new controller implementation.
[Lambda allocation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html),
[Functions concurrency](https://learn.microsoft.com/en-us/azure/azure-functions/functions-concurrency)

VMSS and ASG can later reuse resource/lifecycle mechanics with VM-sized presets and longer **measured**
startup assumptions. They scale hosts, not Kubernetes pods. A cluster autoscaler would additionally need
scheduling, pending pods, host capacity and placement; nesting a service in a boundary is not enough to infer
that model. Predictive scaling, schedules and provisioning failures remain explicit later work.

## 3. Simulation-time controller and replica lifecycle

### Evaluation, readiness and draining

Use a pure controller over a resource/metric snapshot and checkpointed controller state. Schedule its next
evaluation on the existing integer simulation clock, never `Date.now`, browser timers or frame counts.
Pause, speed changes, background tabs, replay, seek and headless analysis must produce the same decisions at
the same simulated time. The first evaluation is at one configured interval after time zero; initial replicas
are a separately authored starting condition (default the policy floor), assumed already ready. Cold-start
scenarios explicitly start at zero. Reset returns to those conditions.

At a tick boundary, preserve timeline order: apply authored actions; advance due startup/termination and
previous work; publish metric-window boundaries; run due controllers in stable node order; apply all fleet
changes in one batch; refresh only affected P2 assignments; inject/pull new work with the resulting readiness.
Record the exact order in the model revision. Do not loop one controller repeatedly until its target is met.

Controller pipeline: read valid metrics → calculate per-metric recommendation → combine safely → apply
tolerance → stabilize recommendations → apply rolling change policies → clamp min/max → reconcile desired
with starting/ready/draining counts. Real controller differences (KEDA zero handling, Monitor step rules,
ECS cooldowns) are adapters, not one universal HPA algorithm. Missing samples retain their validity status.
Use a 15 s CPU integration window as the **simulation HPA assumption**, distinct from its 15 s sync; metric
lag/window are Advanced settings. Readiness sample filtering follows §2. Do not insert startup zero samples.
For KEDA, run the inactive/zero branch before HPA: an eligible `idleReplicas: 0` transition overrides the
active minimum, and activation restores `max(1, minReplicas)`. Ordinary min/max clamping applies to its
active HPA branch; it must not accidentally clamp the idle state back to one.

```text
desired increase → starting (no slots) → startup delay expires → ready (eligible slots)
desired decrease → draining (no new admission) → active work ends / grace expires → removed
```

Startup is a per-replica delay, including image/process initialization and readiness as one coarse assumption.
Use fixed 5 s for the lesson, optionally a seeded bounded distribution in Advanced. Do not charge that delay
to each request on a warm replica. Keep starting counts in reconciliation so repeated polls cannot launch
the same requested capacity again. New ready replicas immediately participate in local routing; Kafka rebalance
cost defaults to zero as an explicit simplification, with no claim to model the actual group coordinator.

Scale-down selects empty replicas first, then stable highest replica ID. Stop admissions and broker pulls to
draining replicas, let running work finish, and reassign unstarted queued work. Keep a draining replica's CPU,
memory and identity until it exits; show the temporary difference from desired count. A new scale-up starts
replacements rather than reviving a terminating replica. Kubernetes grace defaults to 30 s, after which real
pods can be killed. At expiry, unfinished broker work uses existing delivery-failure/redelivery rules; pushed
work uses existing local failure/loss counters. Never invent an upstream timeout/reply failure propagation.
Stateful partition ownership stays reserved while that replica drains, so a new reader cannot process its
unfinished partition concurrently. This is a simplified graceful client, not a guarantee for arbitrary pods.
[Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination),
[KEDA long executions](https://keda.sh/docs/2.18/concepts/scaling-deployments/#long-running-executions)

Zero ready replicas means zero slots. Brokers retain work. Only an activation-capable policy can wake from
zero. With no ready request target, P3 decides whether work waits or is rejected; A1 must not bypass admission.
Down/paused remains an explicit outage, distinct from scale-to-zero: scaling must not revive a down node or
spend CPU on a paused one. Freeze controller reconciliation during a node pause while simulation time can
continue elsewhere; resume schedules the next evaluation, with no replay of missed evaluations.

### Partitions and P3 allocation

Feed the **ready, eligible** fleet to `allocateGroupReplicas`, retaining drain ownership as above. Do not
overwrite node `replicas` props on each autoscale event or mutate the saved document. A controller may want
10 replicas while only 3 have partition assignments: report `10 ready · 3 assigned · 7 idle on this group`.
Another HTTP/queue/subscription input can use those replicas; multiple groups still share one node pool.
An idle reader consumes baseline memory and contributes idle CPU to HPA averages. This can make CPU HPA
ineffective on a partition-limited service; the explanation must recommend partitions or processing changes,
not an endless max increase. KEDA's own Kafka cap normally avoids creating those idle consumers.

Agree a small interface with P3 after its merge: controller supplies desired **instances**, fleet supplies
ready/draining instances, P3 resolves admission/concurrency capacity, P2 resolves per-input assignments,
and execution enforces the intersection with CPU. A policy cannot create more function concurrency than its
account allocation, nor bypass a third-party quota. Do not convert a messages/second target into concurrency
without duration. When P3's native serverless policy owns allocation, the new policy selector is unavailable;
optional startup/resource accounting hooks reuse the lifecycle instead of adding a second controller.

Existing Capacity × needs explicit semantics: fixed nodes keep current behaviour; for autoscaled nodes it
scales initial/min/max counts together, rounded and bounded once, never each controller output again. Zero
floors remain zero. It does not multiply CPU costs, requests, targets or P3 shared account quotas. Inputs
must preview the effective range, and saving pins that range. A timeline `replicas` action on an autoscaled
node enters an explicit fixed override until an authored resume-autoscaling action; importing such an action
cannot silently let two owners fight over the count. Policy/resource edits restart the run as today.

### Determinism and bounded work

Keep controller history, next deadlines, startup samples, monotonic replica IDs, resource/occupancy credits,
metric validity, rolling scaling events and drain ownership in engine/runner checkpoints. Use an independent
seed stream derived from run seed + node ID + replica ID for startup jitter so adding a chart/tracer does
not consume routing/failure randomness. Same seed, document and ordered actions must reproduce metrics,
counts and decisions after restore. Do not seed from wall time or render order.

Retain the current 10,000 replica bound, 600,000 ms scenario bound, traffic sampling and planning diagram
budget. Do **not** make `10,000 replicas × 10 ms ticks × all history` the execution plan:

- Represent identical idle/starting replicas as counted cohorts with deterministic ID ranges. Expand only
  busy identities at scale 1, bounded by admitted simulated work; sampled work uses weighted cohorts.
- Maintain due lifecycle/controller events in a stable priority queue. One idle tick inspects the next due
  event, not every replica. Update resource integrals on work/lifecycle transitions.
- Compile group/trigger indexes once. Reassign affected groups once per fleet batch, never scan all messages
  or partitions on every metric read. Queue/group lag must be an indexed real-unit counter.
- Bound metrics to 1 s buckets for the 10 min run (600 buckets per active node); rolling recommendation/change
  history to its configured window. Enforce controller intervals ≥ 1 s, ≤ 16 metrics/triggers and ≤ 8 policies
  per direction; at most 600 evaluations per node in a run. Reject larger imported configs with a diagnostic.
- Live frames return aggregate resource/count metrics; a selected page contains at most 50 replica rows.
  No 10,000 DOM rows or per-replica chart history. Keep an aggregate 600-point replica chart with event markers.
- Budget scenario planning using existing `src/planning/budget.ts` conventions; return “Unavailable for this
  diagram” with a reason when exceeded, never a partial answer presented as exact. Keep new engine/adapters lazy.

Use operation counts for these guarantees, and same-run `growth()` comparisons (small input one eighth of
large, limit 24) where needed. No wall-clock performance assertions or `waitForTimeout`.

### Capacity, checks and explanations

Preserve `analyzeCapacity` as a pure configured estimate; add a bounded **scenario evaluation** using the
same controller/execution functions for bursts and time-to-ready. Distinguish current ready capacity,
steady-state capacity at policy max, and the observed/scenario trajectory. Never substitute max replicas
for ready replicas and paint a burst healthy while pods are starting. Keep slot utilisation, CPU request
utilisation and memory risk as separate quantities. Resource-less fixed diagrams keep their old arithmetic.

For steady CPU target `t`, one replica needs approximately `requestCores × t × 1000 / cpuMsPerMessage`
messages/s at target; also check slot capacity, P2 assignments, P3 quotas and memory feasibility. Lag targets
are backlog per worker, not a throughput guarantee: duration and incoming demand determine whether that
backlog drains. Nonconvergent demand and unknown metrics still suppress automatic sizing fixes.

Example explanation: **“At 3× traffic the HPA hits max 10 at 92% CPU of request. Raise max to 14 for a 70%
target.”** Its arithmetic is `ceil(10 × 0.92 / 0.70) = 14`; with a 500m request that is 4.6 CPU cores of
measured/estimated work. This is an explicitly configured 70% target, not HPA's omitted-metric 80% default.
Before offering **Apply fix**, rerun with max 14 and verify partition assignments, startup, quotas and memory
permit improvement. If only three partitions can work, say that and offer the appropriate partition fix.
Increasing max cannot fix a baseline above a memory target or an external quota.

Extend existing capacity findings/planner actions with policy paths (`autoscaling.maxReplicas`, target,
startup/min warm instances); do not “fix” an active controller by writing `replicas`. Show the metric window,
target, unclamped recommendation, limiting policy and next eligible simulation time under **Why**. Example:
“Wants 14; max 10” or “Keeping 6: highest recommendation in the last 300 simulated seconds”. Checks cover
invalid request/target combinations, no wake-up metric, partition limits and memory risk. Observed trouble
keeps owning actual growing lag/loss; no duplicate warning engine. One primary Apply fix, undoable, with
before/after assumptions and scenario horizon. A1 can show arithmetic; A3 supplies the bounded scenario planner.

## 4. Data model, persistence and import

### Node-owned policy, separate runtime state

Keep resources and one policy in `DiagramNode.props` / `NodeSimProps`, alongside the node's fixed `replicas`.
No scaler stencil or mandatory edge: the scaler is behaviour attached to compute. Its metric binding can
reference a broker node plus group/subscription, independently of the consuming edge. Connections retain
consumer policy; they do not own a second replica pool. Shared App Service plans and host pools require a
future explicit shared allocation object; a boundary is not implicitly one.

Proposed contracts below are design sketches, not additions to the current TypeScript API:

```ts
interface ComputeResources {
  preset: string;
  presetRevision: string; // pin numerical values and evidence as with P1
  cpuMsPerMessage: number;
  baselineMemoryMiB: number;
  memoryMiBPerMessage: number;
  cpuRequestMilli?: number;
  cpuLimitMilli?: number;
  availableCpuMilli?: number; // explicit simulation assumption if no CPU limit
  memoryRequestMiB?: number;
  memoryLimitMiB?: number;
  startup: { delayMs: number; jitterFraction: number };
  terminationGraceMs: number;
}

type MetricBinding =
  | { kind: "resource"; resource: "cpu" | "memory"; container?: string }
  | {
      kind: "broker";
      node: string;
      group?: string;
      measure: "uncommittedLag" | "activeMessages" | "visible" | "visibleAndInFlight" | "readyAndUnacked";
    }
  | { kind: "http"; node: string; measure: "activeRequests" | "requestsPerMinute" }
  | { kind: "trace"; id: string; unit: "cores" | "MiB" | "count" | "requests/min" };

type MetricTarget =
  | { kind: "utilization"; percentOfRequest: number }
  | { kind: "averageValue"; value: number }
  | { kind: "value"; value: number };

interface ScalingMetric {
  source: MetricBinding;
  target: MetricTarget;
  windowMs: number;
  metricDelayMs: number;
}
interface DirectionBehaviour {
  stabilizationMs: number;
  selectPolicy: "Max" | "Min" | "Disabled";
  policies: { type: "Pods" | "Percent"; value: number; periodMs: number }[];
}
interface HpaSettings {
  syncMs: number;
  tolerance: number; // ratio, 0.1; not 10 percentage points of CPU
  initialReadinessDelayMs: number;
  cpuInitializationPeriodMs: number;
  metrics: ScalingMetric[];
  up: DirectionBehaviour;
  down: DirectionBehaviour;
}
type KedaTrigger =
  | { type: "kafka"; source: MetricBinding; target: number; activation: number; allowIdleConsumers: boolean }
  | { type: "azure-servicebus"; source: MetricBinding; target: number; activation: number }
  | {
      type: "aws-sqs-queue";
      source: MetricBinding;
      target: number;
      activation: number;
      scaleOnInFlight: boolean;
      scaleOnDelayed: boolean;
    }
  | {
      type: "rabbitmq";
      source: MetricBinding;
      mode: "QueueLength";
      target: number;
      activation: number;
      protocol: "http" | "amqp";
      excludeUnacknowledged: boolean;
    };

interface ReplicaRange {
  minReplicas: number;
  maxReplicas: number;
  initialReplicas: number; // warm initial state; does not waive future startup
}
type ExecutableScaler = ReplicaRange &
  (
    | { kind: "hpa"; settings: HpaSettings }
    | {
        kind: "keda";
        pollingMs: number;
        cooldownMs: number;
        initialCooldownMs: number;
        idleReplicas?: 0;
        cacheMetrics: boolean;
        triggers: KedaTrigger[];
        hpa: HpaSettings;
      }
  );
type AutoscalingConfig =
  | { mode: "off" }
  | { mode: "on"; modelRevision: "a1"; preset: string; presetRevision: string; controller: ExecutableScaler }
  | { mode: "unsupported"; provider: string; reason: string; range?: { minReplicas: number; maxReplicas: number } };

// Extend NodeSimProps (not replace P3's allocation fields):
interface AutoscalingNodeProps {
  resources?: ComputeResources;
  autoscaling?: AutoscalingConfig;
}
```

The unions need semantic validation: utilisation only for resource/request metrics; total `Value` and per-pod
`AverageValue` must use their respective HPA formulas; a broker source must match its trigger and reference a
valid group; RabbitMQ AMQP cannot claim unacked visibility. Reject impossible combinations, not just NaN.
Absolute resource targets use millicores for CPU and MiB for memory; broker targets use real messages and
HTTP request-count targets use requests/minute. Trace units require an explicit compatible conversion;
unknown units are unsupported. Convert imported Kubernetes CPU quantities for targets as well as requests.
KEDA CPU/memory triggers may be translated to HPA resource metrics, but cannot provide zero activation alone.
The experimental `apache-kafka` scaler must not be silently aliased to stable `kafka` policy semantics.

A3 adds discriminated adapters, not opaque generic “cloud settings”: ECS (metric, target, metric period,
alarm-window assumption, scale-in/out cooldown); ACA (HTTP/event rule and concurrency target); Monitor
(metric/window/operator/threshold/step/cooldown, min/default/max); Cloud Run (CPU/concurrency targets, maximum
concurrency, min/max and approximate lifecycle). Native Functions/Lambda are **P3-owned**, not members of
`ExecutableScaler`. Preserve adapter version/evidence and capability support in every resolved profile.

Runtime state is separate: `desired`, `starting`, `ready`, `draining`, per-input assigned counts, resource
integrals, cohort/replica IDs, deadlines, metric validity, recommendations/change history and reason codes.
Persist authored configuration only; checkpoints retain runtime state. Reports expose tagged real units and
explicit denominators so neither agents nor UI multiply sampled work again.

### Migration and schema rules

Do not change playback for missing resources/scalers. Preserve `diagrams/v1`, p1 and p2 exactly until explicit
upgrade. Continue `diagrams/v2`, but use a **new, strictly recognised planning revision composing P3 and A1**
(working name `p3-a1`, settled with the P3 implementation). Current readers refuse unknown `planning.revision`;
an additive nested field under `p2` alone would be silently ignored and is therefore unsafe. If A1 precedes
P3, use a distinct `p2-a1` revision and explicit later upgrade; never rewrite P3's semantics to make it fit.

Preview the model upgrade, pin old effective numbers and all saved setup/timeline partial patches, then add
resource assumptions only where enabled. Keep the existing resolver order; nested `resources` and
`autoscaling` are **atomic replacement properties** in native/agent/timeline patches, avoiding accidental
partial deep merges. UI edits merge locally and validate the complete replacement. Null removes a whole
property in agent update ops; it does not mean numeric zero. Switching off preserves resources deliberately;
removing resources with an active resource metric is a validation error.

Initial/min/max are integers 0–10,000, max ≥ min, initial within range, HPA min ≥ 1. CPU request/limit and
available CPU: positive finite ≤ 1,000,000m; memory quantities finite 0–1,048,576 MiB (requests/limits > 0);
CPU work 0–600,000 CPU-ms/message. Times stay within 600,000 ms, intervals ≥ 1,000 ms; enforce history and
collection bounds from §3. Limit must be ≥ request when both known. `baseline > limit` is an unsafe scenario
finding, not silently clamped away. HPA resource utilisation targets may exceed 100% of request; validate
positive targets with a documented simulator cap (proposed 1,000%), not the existing 0–1 fraction schema.
Flag unsupported imported policy periods rather than squeezing them into a smaller interval.

Update shared `src/model/simProps.ts` validation, native JSON/clipboard/storage, both native schemas,
simulation setup/timeline/Inputs, `src/ai/schemas.ts`, `src/ai/index.ts`, agent validation and exports together.
Validate reference bindings after copy/paste/import; remap referenced broker IDs and inferred groups, never
retarget a policy to a coincidentally matching label. Unsupported revisions/settings fail explicitly at every
ingress. Legacy download warns autoscaling cannot be preserved: a pinned fixed snapshot is a named lossy
export, never equivalent playback. Undo restores configuration and model revision together.

Agents continue using `edit_diagram` `add_node` / `update` with full `props.resources` and `props.autoscaling`
objects; no cloud provisioning op. `describe_diagram` returns policy support, resolved metric bindings,
evidence, configured range and bounded numerical explanation. Live observation can expose aggregate counts
and last decision through the existing simulation tools; do not ship entire histories by default. Invalid
references, conflicting controllers and unsupported metrics return actionable structured diagnostics.
Implementation runs `pnpm schemas`, updates generated skill references/schema/validator tests, then checks
viewer freshness and performs the required skill release/version bump when stale. This research changes none
of those generated artifacts.

### Kubernetes import mapping

Keep all import bounded and local. Parse Kubernetes quantities exactly before converting CPU to millicores
and memory to MiB; do not confuse `500m`, `0.5`, `256Mi` and decimal `256M`. Effective defaults can depend on
LimitRange/admission, which an exported manifest might omit. Do not infer CPU cost or memory/message from
requests/limits: they are different dimensions. Imported workloads need an explicitly acknowledged workload
lesson or measurements before enabling resource-based predictions.

| Manifest input                                                                     | Proposed persisted mapping / unsupported behaviour                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workload containers' `resources.requests/limits`                                   | `resources` denominators/ceilings plus container-aware evidence. Support one workload container first; sidecars/init-container accounting unresolved → diagnostic, no fabricated pod sum                                                           |
| HPA namespace + `scaleTargetRef`                                                   | Resolve the exact workload; attach one `hpa` policy. Preserve API version/kind selection, no cross-namespace name fallback for controller ownership                                                                                                |
| HPA `minReplicas`, `maxReplicas`                                                   | Explicit range; default min 1, required max. Initial workload replica count if supplied and in range, otherwise floor; do not treat imported status as live                                                                                        |
| HPA `metrics[]`                                                                    | Resource/ContainerResource name, target type, averageUtilization/averageValue/value → metric bindings and targets. Missing list → 80% CPU. Pods/Object/External selector without a supported local binding → `unsupported`, retaining safe summary |
| HPA `behavior.scaleUp/scaleDown`                                                   | Stabilization windows, selectPolicy and rolling Pods/Percent periods. Controller flags are unknown cluster settings; pin published defaults as assumptions unless explicitly supplied                                                              |
| ScaledObject `scaleTargetRef`, min/max                                             | KEDA policy on exact workload, default 0/100, with optional idle 0. Preserve explicit zero, unlike today's fixed-replica floor conversion                                                                                                          |
| KEDA `pollingInterval`, `cooldownPeriod`, `initialCooldownPeriod`                  | Seconds → milliseconds, separate activation clock, zero cooldown and initial guard                                                                                                                                                                 |
| KEDA `advanced.horizontalPodAutoscalerConfig.behavior`, trigger `useCachedMetrics` | Generated HPA behaviour and per-trigger cache support; mixed caching must be represented or diagnosed, not collapsed silently to one bool                                                                                                          |
| Kafka trigger metadata                                                             | Named broker/topic/group + lag/activation targets + idle-consumer policy. Preserve existing inferred consumer routes; missing topic/history or unsupported partition/offset modes → diagnostic                                                     |
| Service Bus trigger                                                                | Queue or exact topic subscription binding + messageCount/activationMessageCount, default 5/0                                                                                                                                                       |
| SQS trigger                                                                        | Local queue binding + queueLength/activationQueueLength + in-flight/delayed flags, default 5/0/true/false. Delayed visibility not implemented yet → diagnostic when requested                                                                      |
| RabbitMQ trigger                                                                   | Exact queue, protocol, QueueLength/value, activation and unacked semantics. Legacy queueLength 20 retained as legacy evidence; unsupported rate/regex modes → diagnostic                                                                           |
| ScaledJob `jobTargetRef` / range / triggers / strategy                             | Import finite-job identity and safe scaler summary as `mode: unsupported` with reason “Job execution is not simulated”; never attach HPA to its synthetic workload                                                                                 |

If a KEDA-generated HPA accompanies its owning ScaledObject, link it through ownership metadata and avoid two
controllers. A separate HPA and ScaledObject targeting the same workload is a conflict, not “take the greater
floor”. Preserve both safe summaries and require a deliberate policy choice. Diagnostics can retain scalar
targets, kind and reason, but never raw manifests, authentication fields, secret values, host URLs with userinfo
or arbitrary executable queries. Unsupported triggers keep useful inferred topology while clearly reporting
that scaling is not simulated. Import preview must distinguish fixed-count inference from executable scaling.

## 5. UX review: simple by default

Against [`UX-PRINCIPLES.md`](../UX-PRINCIPLES.md): **no new top-bar control, global mode, scaler node or floating
panel**. In a compatible compute node's existing Simulation inspector, use one preset selector that includes
Fixed and HPA/KEDA lessons. Autoscaling off leaves the existing fixed-capacity fields and no empty resource
charts. The autoscaling section has **four main fields total**, including the preset:

1. **Preset** (Fixed; HPA service; KEDA Kafka worker; other supported family lessons).
2. **Target** (CPU % of request or messages/worker, with the denominator visible).
3. **Minimum replicas**.
4. **Maximum replicas**.

Choosing a lesson pins resources and timing assumptions in one Undo step; a hint says “Workload assumption;
measure your service”. If exactly one broker input fits, bind it visibly in the Target hint. Multiple inputs
require a source choice in **Advanced** before enabling; do not guess or add a fifth main field. Advanced
contains resources, startup/grace, initial ready replicas, metric binding/window/lag, activation, cooldown,
behaviour policies and evidence links. Show only settings the selected controller executes. Existing Latency
and Concurrency remain in a folded workload section while autoscaling is on; do not stack another permanent
four-field panel above them. Unsupported imports show a read-only explanation and one action to choose a
supported preset, never enabled controls that do nothing.

On canvas, extend the existing replica badge: `3 ready → 6 desired`, then `3 ready · 3 starting` while useful.
On reaching max, `10 ready · max reached`; mention idle partition readers separately. A selected node's Live
details shows per-replica CPU/memory and a small aggregate count-over-time chart, with desired as a dashed line,
ready solid and startup/drain markers. Keyboard users get an equivalent summary and paginated table. Do not
draw 10,000 pod shapes, sparkline every node, animate every percentage change, or let labels overlap badges.

Why/Apply fix reuse P1's explanation and existing capacity/check surfaces. A screen reader hears units,
denominators, assumptions and max/cooldown reason; status never depends on colour alone. Rate-limit live
announcements to decision changes. Labels use `t()` keys in `src/i18n/en.ts`; implementation runs `pnpm i18n
check`. Screenshots/fixtures belong in the Lab, using synthetic diagrams. Production E2E selectors use only
`data-testid`. Test a 1280×800 inspector, keyboard focus/Undo, presentation/recording/HTML, both themes and
translated/RTL chrome. The chart remains within selected details, and presentation uses the compact badge.

Design review conclusion: four controls are sufficient if preset owns resource assumptions and Advanced owns
metric-source selection. A separate autoscaler palette, global CPU dashboard, always-visible per-pod meters
and editable unsupported cloud knobs are rejected because they consume chrome without helping the first use.
Each implementation PR still needs the repository's independent UX review gate; this written review does not
claim the future UI was built or tested.

## 6. Phasing and acceptance

Three implementation PRs after this research is reviewed. Each is independently useful, preserves old files,
and ends with tests that fail when the corresponding fix is temporarily removed, production E2E where UI is
changed, and a UX review. These are future acceptance tests, not claims of tests added in this docs-only branch.

### A1 — Resources, replica lifecycle and HPA

Build opt-in resource profiles/resolution, CPU execution, memory risk reporting, deterministic fleet state,
HPA resource metrics/default policies, model upgrade, bounded live readouts and basic numerical explanations.
Use P3's merged allocation contract if present; otherwise leave the native-serverless hook unimplemented and
hide that capability. Custom metrics bind only to bounded local traces; unsupported import remains explicit.

Acceptance:

- **CPU accounting:** equal elapsed latency with different CPU cost produces different CPU utilisation;
  CPU limit throttles completions, request changes only the denominator. Known work integrates to known
  CPU-seconds. Memory includes idle baseline, active occupancy and drain lifetime, with explicit limit-risk
  reporting. Remove CPU limiting/accounting and prove the tests fail.
- **Burst:** fixed seed, jitter off, min/initial 1, max 10, target 50%, known CPU demand. At the first valid
  sync, expected raw desired is calculated; the default +4/+100% policy caps the change. No extra throughput
  before the configured startup deadline. Repeat at different playback speeds and after checkpoint restore;
  same fleet/metric/event trajectory. Remove evaluation/startup gating and demonstrate regression failures.
- **Stabilization:** record a high recommendation, remove demand, and assert no downscale while it remains
  in the 300 s history. At the first eligible evaluation after expiry, the low recommendation takes effect.
  This is a simulated deadline assertion, not a wall-clock timing budget. Disable the rolling maximum and
  prove failure. Also test tolerance and missing/readiness metrics cannot cause unsafe shrink.
- **Max reached:** demand implies 14 while max is 10; desired clamps, reason identifies max and observed
  resource/slot utilisation stays honest. Raising max improves only after startup and only when no other
  limit binds. A memory baseline above target produces a persistent-unfixable-by-replicas explanation.
- **Drain:** work completes on a draining replica without accepting more; grace expiry uses existing failure
  paths once; no orphaned slots, negative counters or duplicate delivery. Restart/restore reproduces it.
- **Compatibility/bounds:** legacy/p1/p2 unchanged; new revision rejected by older readers; native/agent/
  clipboard/HTML round trips, setup/timeline atomic replacement and Undo. 10,000 idle replicas do not cause
  per-replica idle-tick work; assert operation counts and `growth()` where appropriate.

### A2 — KEDA activation, broker metrics and Kubernetes import

Add ScaledObject triggers from §2, zero lifecycle, Kafka desired-count cap/idle-consumer option and exact import
mapping/diagnostics. Import ScaledJob honestly as unsupported execution. No new broker delivery or retry policy;
use current semantics and identify missing broker-visibility features.

Acceptance:

- **Lag scaling:** topic/group lag 95, threshold 10 → raw recommendation 10; a three-partition topic caps KEDA
  desired to 3 by default (growth policies still apply). Another group/subscription's backlog does not leak in.
  Remove the lag metric adapter/cap and prove both expectations fail.
- **Activation/zero:** min 0, lag at activation threshold stays asleep; threshold + 1 starts one replica on
  the next poll; no execution before startup. After last activity, zero cooldown is observed independently of
  HPA's 1→N down stabilization. No valid zero-wake metric yields an actionable warning. Disable strict
  activation or final-zero cooldown and prove failures.
- **Idle replicas:** HPA with 8 ready readers on 3 partitions, and KEDA with `allowIdleConsumers: true`, both
  assign only 3 and show 5 idle for that group. Add an HTTP or subscription input and prove spare ready
  replicas can serve it without letting the log exceed its assignment. Disable P2's group gate to prove failure.
- **Trigger counts:** Service Bus subscription 5/0 defaults; SQS visible plus in-flight once, delayed excluded;
  RabbitMQ AMQP ready versus HTTP ready+unacked. Test sampled and real-unit metrics with a stated bound of
  one represented message per measurement boundary, and scale-1 exact cases for threshold decisions.
- **Import:** HPA/KEDA quantities, targets, min/max including zero, behaviour, namespaced references, ownership,
  unsupported triggers/ScaledJob and duplicate-controller diagnostics. No credentials in persisted summaries.
  Generated schemas/agent tools and HTML describe the same support. Remove a mapping to prove its fixture fails.

### A3 — Cloud adapters and scenario sizing

Add the bounded scenario planner and cloud profiles for ECS CPU/ALB, ACA HTTP/event, Monitor App Service/VMSS,
and approximate single-revision Cloud Run. Reuse P3 Functions/Lambda allocation and startup hooks. ASG target
tracking can use the same lifecycle with a labelled approximation; predictive/simple/step variants beyond the
implemented Monitor rules remain unsupported. Ship only adapters with working metrics, tests and honest
approximation labels; scope can be reviewed per adapter without inventing missing provider behaviour.

Acceptance:

- ECS CPU and ALB-request/minute targets choose the correct units; cooldown blocks shrink but permits an
  urgent larger scale-out. No missing-data scale-in or CPU-only wake from zero. An ALB target cannot bind to
  arbitrary async message throughput. Alarm-window assumptions are visible.
- ACA HTTP threshold is 10 by default and remains separate from P3 admission. Event activation uses its own
  poll. Monitor rule windows/steps/OR-out/AND-in/cooldown work on simulation time and do not pretend to be HPA.
  Cloud Run uses pinned concurrency, request wakeup and correct min/max/CPU denominators; approximations show.
- Two P3 functions share a quota while independently demanding growth: autoscaling cannot invent additional
  allocation. Reserved/provisioned concurrency retain distinct units. No “add replicas to a SaaS API” action.
- Reproduce the `3× / max 10 / 92% / target 70% → max 14` example, verify the action with a same-seed rerun,
  then add a partition or account limit and ensure the proposed fix changes appropriately. Startup backlog
  remains visible even when steady-state max capacity suffices. Bounded planner exhaustion reports unavailable.
- Snapshot/restore, scale 1 versus sampled traffic, large-count work bounds, i18n and production UX/E2E
  acceptance all pass. For each corrected behaviour, remove its guard/adapter and demonstrate a failing test.

## 7. Decisions rejected, deferred and unresolved

- **A percentage of CPU “per message” without time/CPU allocation:** rejected; use CPU-ms and an explicit
  denominator. A latency increase from downstream I/O must not imply more CPU automatically.
- **Autoscale instantly to the capacity formula:** rejected; misses evaluation, stabilization, startup and
  drain, and falsely declares bursts safe. Capacity is an estimate; scenario replay supplies dynamics.
- **One controller for every cloud, or HPA on functions:** rejected; erases trigger/units/lifecycle differences
  and duplicates P3. Cloud adapters are versioned approximations where exact behaviour is not documented.
- **Always cap desired replicas at partitions:** rejected; only KEDA Kafka's default controller does that.
  HPA/idle-enabled KEDA can create idle readers; P2 limits their work independently.
- **Memory admission masquerading as Kubernetes memory limits:** rejected. First release reports OOM risk;
  actual OOM, GC, restart/backoff and startup CPU profiles need further review and tests.
- **Full ScaledJob/cluster scheduling, multi-container accounting, shared plan/host placement, real Kafka
  rebalances, live provider metrics and cost:** deferred. Each needs a separate lifecycle/allocation contract;
  none is made accurate by a new numeric field. No billing or real deployment claim follows from this design.
- **Unverified reaction guarantees:** exact ECS managed-alarm windows, Cloud Run evaluation cadence and
  universal Java/.NET/container/VM cold-start numbers remain **UNVERIFIED**. Require authored measurements
  or an explicit assumption. Official default values above are not measurements of a user's infrastructure.
- **Remaining implementation decisions:** agree the combined planning revision with P3; review CPU-sharing
  discretisation and sampled occupancy error bounds in A1 before setting acceptance tolerances. If the sampler
  cannot preserve activation at a workload's scale, require scale 1 for that scenario and explain why.

This research introduces no user-visible feature, so it does not add a release-note entry promising one.
Implementation PRs must add `docs/release-notes/YYYY-MM-DD-short-slug.md` fragments for the behaviour they actually ship.
