# Roadmap

The plan for the coming week, in execution order. Each item ships as reviewed PRs: an independent code review, every fix covered by a test that fails without it, and CI on the production build. The research behind each item is linked. Last updated 2026-10-14.

## In flight

| Item                            | What it is                                                                                                                                                                       | Research                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Planning P3 (sim item 8)        | Serverless concurrency; rate limits for external APIs and models that reject; unknown limits stay unknown                                                                        | [planning-model](research/planning-model.md)       |
| Output-parity harness           | Golden outputs (simulation, checks, exports, imports, agent tools, layout, i18n) that every refactor must reproduce exactly                                                      | to be written: `docs/PARITY.md`                    |
| Benchmarks                      | Workloads of 100–5,000 nodes; load, render, typing, live tick, checks, planning, memory, render counts and bundle size. Robust CI gates, a committed baseline and a hotspot list | to be written: `docs/BENCHMARKS.md`                |
| Self-hosting kit                | Docker image, Kubernetes manifest and Helm chart, templates for static hosts, an air-gapped bundle, a header verifier, and a rewritten guide                                     | [SELF-HOSTING](SELF-HOSTING.md)                    |
| Research: C4 multi-level views  | One model, viewed at Context, Container and Component level                                                                                                                      | to be written: `research/c4-views.md`              |
| Research: competitive landscape | A sourced feature matrix against about 15 tools, plus the top opportunities                                                                                                      | to be written: `research/competitive-landscape.md` |

## Next, in order

1. **Autoscaling** ([autoscaling](research/autoscaling.md))
   - A1: per-message CPU and memory, replica lifecycle, Kubernetes HPA.
   - A2: KEDA (lag and queue length, scale to zero) and Kubernetes import mapping.
   - A3: ECS, Container Apps, App Service, Cloud Run, plus planner suggestions for min and max replicas.
2. **P6: endpoints and routing** ([routing](research/routing.md))
   - R1: optional routes, source traffic mixes, gateway route tables and per-route particle colours.
   - R2: endpoints and per-route capacity.
   - R3: Fastly stencil and OpenAPI import of routes.
3. **P4: per-broker failure policy** (sim item 9): Kafka in-place retry, Service Bus built-in DLQ, SQS visibility timeout.
4. **Item 10: request/reply semantics**, as staged PRs. Failures propagate back to callers, callers hold slots while waiting, and timeouts and retries take effect.
5. **Refactoring and performance round.** Guarded by the parity harness (no output changes) and measured by the benchmarks:
   - Split CanvasView, Inspector, LiveSession and useEditor into smaller modules.
   - Add one derived-state layer that separates configuration changes from live metrics.
   - Fix the benchmark hotspots, moving work to workers where it helps.
   - Audit test health and code health; consolidate the docs.
6. **C4 multi-level views**, built on the refactored canvas: the model and migration, drill-down, editing across levels, simulation roll-up, Structurizr and Mermaid C4 export, and view switching in the viewer.
7. **The rest of the planning plan** ([planning-model](research/planning-model.md))
   - P5: vendor API profiles.
   - P7: OpenAPI import.
   - P8–P9: education for each stencil.
   - P10: capacity, headroom, what-if comparisons and growth.
   - P11: latency budgets (p50/p95, which needs item 10).
   - P12: cost hints.
8. **Languages.** Translate the inspector, live view, capacity, planning and checks screens once the branches above have merged; then the static pages.
9. **Known gaps from reviews:**
   - Add a consumer restarts the run.
   - A node keeps its old name after its stencil changes.
   - Agent `connect` into Key Vault without a relation.
   - Infrastructure imports don't mark inferred relations.
   - Dependency outages aren't simulated.

## Waiting for the owner's decision

- The import picker: the default pick size, and the wording for Strimzi-made secrets.
- Network batches 2–4 (more vendors, WAN links and rulebases, wireless and DNS/IPAM) and vendor logo badges.
- Languages: startup size, first-visit loading, and number grouping in English.
- Competitive opportunities, such as collaboration options that keep the no-backend privacy, diagrams-as-code, and Confluence, Notion or VS Code integrations. These follow once the landscape research is in.
