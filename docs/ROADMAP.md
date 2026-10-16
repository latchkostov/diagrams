# Roadmap

The plan for the coming week, in execution order. Each item ships as reviewed PRs: an independent code review, every fix covered by a test that fails without it, and CI on the production build. The research behind each item is linked. Last updated 2026-10-16.

## In flight

| Item                     | What it is                                                                                                                                                                                   | Research                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Performance round        | PR 1 (editing) shipped. Now: full routing speed, export off the main thread, viewport virtualisation, then live view (hotspots 6, 9, 10) after R1                                            | [BENCHMARKS](BENCHMARKS.md)                |
| Routing R1               | Optional request routes: traffic mixes, gateway route tables (Kong and Fastly style) and per-route particle colours; off by default                                                          | [routing](research/routing.md)             |
| Collaboration C0         | Browser-only proof and foundations: threat model, Yjs mapping with per-user undo, E2E encryption with the key in the link's fragment, presence, and a transport interface. Behind a lab flag | [collaboration](research/collaboration.md) |
| Local gate reliability   | The full local gate (all six e2e shards) passes on clean master, and the gate never reuses an existing server                                                                                | [QUALITY](QUALITY.md)                      |
| Review follow-ups 2      | A view fit never saves or promotes an example; one shared boundary-refit planner; P2s from recent reviews                                                                                    | —                                          |
| Static-page translations | The sign-in and /skill/ pages. Privacy and Terms stay English pending the owner                                                                                                              | [I18N](I18N.md)                            |

Shipped since the last update:

- Autoscaling is complete: A2, KEDA on broker metrics with scale to zero and Kubernetes import (#125); A3, ECS, Container Apps, App Service and Cloud Run, plus scenario sizing (#135).
- The benchmark suite, with machine-independent CI gates and a hotspot list (#127).
- Performance PR 1: editing (#130). Node renders per key dropped from 725 to 1.5 at 500 nodes, and drag frames are up to 5× faster, with identical routes.
- View fits wait on settled signals, not timers, which makes the parity browser tier stable (#126).
- Known gaps: default names follow stencil changes, and agent `connect` infers relations (#131).
- Nightly fixes (#133), including the live view Esc keyboard listener.
- Research: vendor API profiles for P5 (#128), and real-time collaboration, serverless first and end-to-end encrypted (#132).

Rules: every user-visible feature ships with a showcase example. Every push passes the full local gate first.

## Next, in order

1. **Autoscaling**: shipped (A1 #117, A2 #125, A3 #135).
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
6. **Real-time collaboration** ([collaboration](research/collaboration.md)), serverless first: C0 (browser proof, in flight) → C1 (anonymous, end-to-end encrypted co-editing over WebRTC with public matchmaking, plus presence) → the owner decides on an optional self-hostable relay, using C1 beta connectivity data → C2 (cursors, presenter mode, comments) → C3 (optional accounts and invites) → C4 (history). No server is built without the owner's approval.
7. **C4 multi-level views**, built on the refactored canvas: the model and migration, drill-down, editing across levels, simulation roll-up, Structurizr and Mermaid C4 export, and view switching in the viewer.
8. **The rest of the planning plan** ([planning-model](research/planning-model.md))
   - P5: vendor API profiles.
   - P7: OpenAPI import.
   - P8–P9: education for each stencil.
   - P10: capacity, headroom, what-if comparisons and growth.
   - P11: latency budgets (p50/p95, which needs item 10).
   - P12: cost hints.
9. **Languages.** Translate the inspector, live view, capacity, planning and checks screens once the branches above have merged; then the static pages.
10. **Known gaps from reviews:**

- Add a consumer restarts the run.
- Infrastructure imports don't mark inferred relations.
- Dependency outages aren't simulated.
- Follow-up review P2s from #123 (contrast budget caching, spatial-query budgets, raw autoscaling prop guards, AI-panel opening while Inputs is open).
- The zoom a diagram opens at depends on timing and drifts slightly under load. The parity harness found it, and it doesn't pin it yet.

## Waiting for the owner's decision

- The import picker: the default pick size, and the wording for Strimzi-made secrets.
- Network batches 2–4 (more vendors, WAN links and rulebases, wireless and DNS/IPAM) and vendor logo badges.
- Languages: startup size, first-visit loading, and number grouping in English.
- Competitive opportunities, such as collaboration options that keep the no-backend privacy, diagrams-as-code, and Confluence, Notion or VS Code integrations. The landscape research is in ([competitive-landscape](research/competitive-landscape.md)). The recommendation is a runnable patterns gallery and portable review comments now; diagram-as-code and VS Code, GitHub, Confluence or Notion integrations after C4.
