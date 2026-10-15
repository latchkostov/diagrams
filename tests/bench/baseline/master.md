# Benchmark results

2026-10-15T23:59:05.270Z · commit `d84fa1e184` on `test/benchmarks` · mode **full**

| Environment |  |
| --- | ---: |
| Machine | AMD Ryzen 9 7950X 16-Core Processor, 32 threads, 68 GB, Windows_NT 10.0.26300 (x64) |
| Runtime | Node v24.22.0, Chromium 156.0.8078.4, Playwright 1.64.1, Vite 8.3.4, React 19.3.1 |
| Browser settings | CPU throttle 2× (main thread), 1440 × 900 at device scale factor 1, light, en-US, UTC |
| Calibration | Node 11 ms, browser 26 ms (same-run baseline; "cu" = ms ÷ calibration) |
| CI | no |

## Gates: 70 of 70 pass

<details><summary>Every gate</summary>

| Gate | Value | Limit |  |
| --- | ---: | ---: | ---: |
| `bundle/canvasFirstView/gzip` | 333.1 kB | <= 368.0 kB | pass |
| `bundle/entry/gzip` | 105.5 kB | <= 123.5 kB | pass |
| `bundle/liveSession/gzip` | 79.7 kB | <= 90.0 kB | pass |
| `bundle/startup/gzip` | 154.2 kB | <= 167.0 kB | pass |
| `checks/analyzeCapacity-per-run` | 1 | <= 3 | pass |
| `checks/compileTopology-per-run` | 2 | <= 2 | pass |
| `checks/runChecks-capacity-mesh/growth` | 12.9× | <= 64.0× | pass |
| `checks/runChecks-capacity-pipeline/growth` | 24.6× | <= 64.0× | pass |
| `checks/runChecks-structural-mesh/growth` | 15.5× | <= 24.0× | pass |
| `checks/runChecks-structural-pipeline/growth` | 9.4× | <= 24.0× | pass |
| `exports/drawio/growth` | 7.9× | <= 24.0× | pass |
| `exports/interactiveHtml/growth` | 4.9× | <= 24.0× | pass |
| `exports/mermaid/growth` | 16.2× | <= 24.0× | pass |
| `imports/import-asyncapi/growth` | 8.3× | <= 24.0× | pass |
| `imports/import-compose/growth` | 8.0× | <= 24.0× | pass |
| `imports/import-kubernetes/growth` | 8.1× | <= 24.0× | pass |
| `imports/import-terraform/growth` | 8.6× | <= 24.0× | pass |
| `layout/autoLayout-mesh/growth` | 10.4× | <= 24.0× | pass |
| `layout/autoLayout-pipeline/growth` | 9.4× | <= 24.0× | pass |
| `layout/routeAll-pipeline/growth` | 23.2× | <= 192.0× | pass |
| `layout/routeDragFrame-maxEdges-mesh` | 26 | <= 64 | pass |
| `layout/routeDragFrame-maxEdges-pipeline` | 10 | <= 64 | pass |
| `layout/routeDragFrame-pipeline/growth` | 10.7× | <= 192.0× | pass |
| `memory/commandPalette/domNodesPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/commandPalette/listenersPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/exportDialog/domNodesPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/exportDialog/listenersPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/inspector/domNodesPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/inspector/listenersPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/liveView/domNodesPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `memory/liveView/listenersPerCycle/pipeline@500` | 0 | <= 0.60 | pass |
| `parse/fromFlow/growth` | 8.1× | <= 24.0× | pass |
| `parse/parseNative-mesh/growth` | 9.2× | <= 24.0× | pass |
| `parse/parseNative/growth` | 7.3× | <= 24.0× | pass |
| `parse/toFlow/growth` | 11.3× | <= 24.0× | pass |
| `planning/analyses-for-20-selections` | 1 | <= 1 | pass |
| `planning/analyzeCapacity/growth` | 8.9× | <= 24.0× | pass |
| `planning/explanations-for-20-selections` | 20 | <= 20 | pass |
| `renders/pan/DiagramNodeImpl/pipeline@100` | 0.30 | <= 1 | pass |
| `renders/pan/DiagramNodeImpl/pipeline@500` | 0.70 | <= 1 | pass |
| `renders/pan/NodeWrapper/pipeline@100` | 41.20 | <= 80 | pass |
| `renders/pan/NodeWrapper/pipeline@500` | 307.40 | <= 400 | pass |
| `renders/select/DiagramNodeImpl/pipeline@100` | 3 | <= 3.50 | pass |
| `renders/select/DiagramNodeImpl/pipeline@500` | 3 | <= 3.50 | pass |
| `renders/select/NodeWrapper/pipeline@100` | 413.67 | <= 500 | pass |
| `renders/select/NodeWrapper/pipeline@500` | 2049.67 | <= 2,500 | pass |
| `renders/select/commits/pipeline@100` | 9.17 | <= 10.50 | pass |
| `renders/select/commits/pipeline@500` | 9.17 | <= 10.50 | pass |
| `renders/type-name/DiagramNodeImpl/pipeline@100` | 1 | <= 1.50 | pass |
| `renders/type-name/DiagramNodeImpl/pipeline@500` | 1.08 | <= 1.50 | pass |
| `renders/type-name/Inspector/pipeline@100` | 1.17 | <= 1.75 | pass |
| `renders/type-name/Inspector/pipeline@500` | 1.25 | <= 1.75 | pass |
| `renders/type-name/NodeWrapper/pipeline@100` | 120 | <= 160 | pass |
| `renders/type-name/NodeWrapper/pipeline@500` | 639.83 | <= 800 | pass |
| `renders/type-name/Palette/pipeline@100` | 0 | <= 0 | pass |
| `renders/type-name/Palette/pipeline@500` | 0 | <= 0 | pass |
| `renders/type-name/PaletteItem/pipeline@100` | 0 | <= 0 | pass |
| `renders/type-name/PaletteItem/pipeline@500` | 0 | <= 0 | pass |
| `renders/type-name/commits/pipeline@100` | 3.42 | <= 4 | pass |
| `renders/type-name/commits/pipeline@500` | 3.67 | <= 4 | pass |
| `renders/type-name/total/pipeline@100` | 328 | <= 450 | pass |
| `renders/type-name/total/pipeline@500` | 1373.58 | <= 1,650 | pass |
| `sim/determinism-checksum-delta` | 0 | == 0 | pass |
| `sim/engineFrame-mesh/growth` | 8.4× | <= 24.0× | pass |
| `sim/engineFrame-pipeline/growth` | 11.0× | <= 24.0× | pass |
| `sim/engineLoad-mesh/growth` | 8.4× | <= 24.0× | pass |
| `sim/engineLoad-pipeline/growth` | 10.5× | <= 24.0× | pass |
| `sim/engineSnapshot-mesh/growth` | 9.5× | <= 24.0× | pass |
| `sim/engineSnapshot-pipeline/growth` | 11.1× | <= 24.0× | pass |
| `sim/idleTick/growth` | 7.6× | <= 24.0× | pass |

</details>

## bundle

| Metric | Value | Note |
| --- | ---: | ---: |
| `allJs/chunks` | 0.1 kB |  |
| `allJs/gzip` | 2.48 MB |  |
| `chunk/AiPanel.js/gzip` | 16.4 kB |  |
| `chunk/CanvasView.js/gzip` | 79.7 kB |  |
| `chunk/ChecksCard.js/gzip` | 5.9 kB |  |
| `chunk/EmbedView.js/gzip` | 2.3 kB |  |
| `chunk/ExamplesDialog.js/gzip` | 1.6 kB |  |
| `chunk/GalleryView.js/gzip` | 7.5 kB |  |
| `chunk/HostEmbedView.js/gzip` | 5.5 kB |  |
| `chunk/HtmlExportDialog.js/gzip` | 4.2 kB |  |
| `chunk/ImportReportDialog.js/gzip` | 4.0 kB |  |
| `chunk/LibraryDialog.js/gzip` | 2.4 kB |  |
| `chunk/LiveSession.js/gzip` | 79.7 kB |  |
| `chunk/OnDeviceInput.js/gzip` | 16.1 kB |  |
| `chunk/PaletteDialog.js/gzip` | 5.7 kB |  |
| `chunk/PasswordField.js/gzip` | 1.3 kB |  |
| `chunk/SequenceDialog.js/gzip` | 6.5 kB |  |
| `chunk/ShareChooser.js/gzip` | 1.7 kB |  |
| `chunk/StorageDialog.js/gzip` | 1.1 kB |  |
| `chunk/WebMcpBridge.js/gzip` | 4.1 kB |  |
| `chunk/addConsumer.js/gzip` | 6.2 kB |  |
| `chunk/aks-app-config-key-vault.js/gzip` | 1.8 kB |  |
| `chunk/annotations.js/gzip` | 1.1 kB |  |
| `chunk/ar.js/gzip` | 49.8 kB |  |
| `chunk/autoscaling-image-workers.js/gzip` | 1.4 kB |  |
| `chunk/autoscalingSchema.js/gzip` | 1.2 kB |  |
| `chunk/aws-fanout.js/gzip` | 1.9 kB |  |
| `chunk/aws-serverless-orders.js/gzip` | 2.6 kB |  |
| `chunk/azure-service-bus-integration.js/gzip` | 2.0 kB |  |
| `chunk/bg.js/gzip` | 51.0 kB |  |
| `chunk/branch-to-datacentre.js/gzip` | 2.1 kB |  |
| `chunk/canvas-shared.js/gzip` | 99.1 kB |  |
| `chunk/capacityPlanning.js/gzip` | 12.8 kB |  |
| `chunk/catalog.js/gzip` | 10.6 kB |  |
| `chunk/cdc-analytics.js/gzip` | 1.7 kB |  |
| `chunk/checks.js/gzip` | 1.5 kB |  |
| `chunk/clearOnPrivate.js/gzip` | 0.3 kB |  |
| `chunk/cloudMessages.js/gzip` | 0.7 kB |  |
| `chunk/codec.js/gzip` | 0.8 kB |  |
| `chunk/colors.js/gzip` | 0.6 kB |  |
| `chunk/context.js/gzip` | 1.0 kB |  |
| `chunk/contoso-dmz.js/gzip` | 1.5 kB |  |
| `chunk/copyForAi.js/gzip` | 0.5 kB |  |
| `chunk/cqrs-event-sourcing.js/gzip` | 2.2 kB |  |
| `chunk/cs.js/gzip` | 46.4 kB |  |
| `chunk/da.js/gzip` | 42.6 kB |  |
| `chunk/de.js/gzip` | 45.4 kB |  |
| `chunk/deadLetter.js/gzip` | 0.3 kB |  |
| `chunk/dialogs.js/gzip` | 7.2 kB |  |
| `chunk/dropbox.js/gzip` | 1.9 kB |  |
| `chunk/el.js/gzip` | 53.5 kB |  |
| `chunk/es.js/gzip` | 5.0 kB |  |
| `chunk/et.js/gzip` | 44.4 kB |  |
| `chunk/event-driven-data-platform.js/gzip` | 3.1 kB |  |
| `chunk/evidence.js/gzip` | 2.0 kB |  |
| `chunk/evidenceClient.js/gzip` | 1.6 kB |  |
| `chunk/evidenceMerge.js/gzip` | 0.7 kB |  |
| `chunk/examples.js/gzip` | 8.1 kB |  |
| `chunk/explanation.js/gzip` | 2.0 kB |  |
| `chunk/fi.js/gzip` | 45.3 kB |  |
| `chunk/fileMessages.js/gzip` | 1.3 kB |  |
| `chunk/format.js/gzip` | 0.8 kB |  |
| `chunk/fr.js/gzip` | 45.5 kB |  |
| `chunk/fuzzy.js/gzip` | 0.6 kB |  |
| `chunk/gcp-streaming-analytics.js/gzip` | 1.9 kB |  |
| `chunk/gdrive.js/gzip` | 3.0 kB |  |
| `chunk/groupHierarchy.js/gzip` | 2.2 kB |  |
| `chunk/he.js/gzip` | 46.8 kB |  |
| `chunk/helpers.js/gzip` | 0.2 kB |  |
| `chunk/hi.js/gzip` | 52.3 kB |  |
| `chunk/hr.js/gzip` | 44.8 kB |  |
| `chunk/hu.js/gzip` | 47.2 kB |  |
| `chunk/i18n.js/gzip` | 0.3 kB |  |
| `chunk/icons.js/gzip` | 0.3 kB |  |
| `chunk/id.js/gzip` | 41.7 kB |  |
| `chunk/image.js/gzip` | 2.0 kB |  |
| `chunk/importMessages.js/gzip` | 2.7 kB |  |
| `chunk/index.js/gzip` | 105.5 kB |  |
| `chunk/infer.js/gzip` | 2.5 kB |  |
| `chunk/iot-telemetry.js/gzip` | 1.9 kB |  |
| `chunk/it.js/gzip` | 43.7 kB |  |
| `chunk/ja.js/gzip` | 49.3 kB |  |
| `chunk/jsx-runtime.js/gzip` | 0.3 kB |  |
| `chunk/kafka-order-pipeline.js/gzip` | 2.2 kB |  |
| `chunk/ko.js/gzip` | 46.7 kB |  |
| `chunk/languageDialogRoot.js/gzip` | 2.1 kB |  |
| `chunk/load.js/gzip` | 2.8 kB |  |
| `chunk/lt.js/gzip` | 46.3 kB |  |
| `chunk/lv.js/gzip` | 45.7 kB |  |
| `chunk/mapping.js/gzip` | 3.3 kB |  |
| `chunk/measured-order-capacity.js/gzip` | 1.1 kB |  |
| `chunk/multi-region-active-active.js/gzip` | 1.9 kB |  |
| `chunk/native.js/gzip` | 11.2 kB |  |
| `chunk/nb.js/gzip` | 42.7 kB |  |
| `chunk/nightly-batch-elt.js/gzip` | 1.9 kB |  |
| `chunk/nl.js/gzip` | 43.5 kB |  |
| `chunk/notification-fanout.js/gzip` | 2.1 kB |  |
| `chunk/oauth.js/gzip` | 2.6 kB |  |
| `chunk/onedrive.js/gzip` | 1.9 kB |  |
| `chunk/ops.js/gzip` | 11.5 kB |  |
| `chunk/outbox-saga-checkout.js/gzip` | 2.6 kB |  |
| `chunk/partitions-vs-subscriptions.js/gzip` | 1.2 kB |  |
| `chunk/passwordCrypto.js/gzip` | 0.6 kB |  |
| `chunk/passwordDialogs.js/gzip` | 1.9 kB |  |
| `chunk/pick.js/gzip` | 0.9 kB |  |
| `chunk/pipeline.js/gzip` | 65.5 kB |  |
| `chunk/pl.js/gzip` | 47.0 kB |  |
| `chunk/preload-helper.js/gzip` | 0.8 kB |  |
| `chunk/pt-BR.js/gzip` | 43.8 kB |  |
| `chunk/pt-PT.js/gzip` | 44.1 kB |  |
| `chunk/rag-assistant.js/gzip` | 2.2 kB |  |
| `chunk/react-dom.js/gzip` | 1.4 kB |  |
| `chunk/react.js/gzip` | 3.3 kB |  |
| `chunk/read.js/gzip` | 4.8 kB |  |
| `chunk/registry.js/gzip` | 4.4 kB |  |
| `chunk/resourceBudget.js/gzip` | 0.5 kB |  |
| `chunk/ro.js/gzip` | 45.1 kB |  |
| `chunk/ru.js/gzip` | 53.4 kB |  |
| `chunk/run.js/gzip` | 13.7 kB |  |
| `chunk/serverless-burst-buffer.js/gzip` | 1.4 kB |  |
| `chunk/shareCrypto.js/gzip` | 0.3 kB |  |
| `chunk/shared-api-quotas.js/gzip` | 1.5 kB |  |
| `chunk/shared-worker-pool.js/gzip` | 1.2 kB |  |
| `chunk/simulation.js/gzip` | 18.3 kB |  |
| `chunk/size.js/gzip` | 0.2 kB |  |
| `chunk/sk.js/gzip` | 46.7 kB |  |
| `chunk/sl.js/gzip` | 45.5 kB |  |
| `chunk/sr-Latn.js/gzip` | 44.9 kB |  |
| `chunk/stencils.js/gzip` | 1.1 kB |  |
| `chunk/storage.js/gzip` | 0.5 kB |  |
| `chunk/sv.js/gzip` | 43.1 kB |  |
| `chunk/th.js/gzip` | 49.6 kB |  |
| `chunk/threadStore.js/gzip` | 1.3 kB |  |
| `chunk/toast.js/gzip` | 0.3 kB |  |
| `chunk/toolList.js/gzip` | 5.8 kB |  |
| `chunk/tr.js/gzip` | 44.8 kB |  |
| `chunk/ui.js/gzip` | 13.1 kB |  |
| `chunk/uk.js/gzip` | 52.6 kB |  |
| `chunk/vi.js/gzip` | 45.1 kB |  |
| `chunk/webhook-ingestion.js/gzip` | 2.3 kB |  |
| `chunk/write.js/gzip` | 1.8 kB |  |
| `chunk/zh-CN.js/gzip` | 45.7 kB |  |
| `chunk/zh-TW.js/gzip` | 46.2 kB |  |
| `entry/brotli` | 91.1 kB |  |
| `entry/raw` | 331.9 kB |  |
| `startup/chunks` | 0.0 kB |  |
| `startup/raw` | 468.5 kB |  |

## checks

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `findings` | annotated | 3 | 22 | 65 | 202 |
| `findings` | examples | 8 | 37 | 100 | 337 |
| `findings` | k8s | 8 | 39 | 119 | 329 |
| `findings` | mesh | 8 | 37 | 122 | 392 |
| `findings` | pipeline | 4 | 21 | 64 | 218 |
| `findings` | terraform | 14 | 69 | 207 | 689 |
| `runChecks` | annotated | 2.13 ms <sub>p90 2.42 ms</sub> | 21 ms <sub>p90 25 ms</sub> | 75 ms <sub>p90 91 ms</sub> | 239 ms <sub>p90 366 ms</sub> |
| `runChecks` | examples | 3.65 ms <sub>p90 3.93 ms</sub> | 43 ms <sub>p90 51 ms</sub> | 138 ms <sub>p90 158 ms</sub> | 553 ms <sub>p90 579 ms</sub> |
| `runChecks` | k8s | 2.93 ms <sub>p90 3.42 ms</sub> | 12 ms <sub>p90 14 ms</sub> | 40 ms <sub>p90 43 ms</sub> | 119 ms <sub>p90 125 ms</sub> |
| `runChecks` | mesh | 3.45 ms <sub>p90 3.60 ms</sub> | 21 ms <sub>p90 25 ms</sub> | 95 ms <sub>p90 102 ms</sub> | 381 ms <sub>p90 417 ms</sub> |
| `runChecks` | pipeline | 2.51 ms <sub>p90 2.72 ms</sub> | 11 ms <sub>p90 13 ms</sub> | 71 ms <sub>p90 76 ms</sub> | 238 ms <sub>p90 271 ms</sub> |
| `runChecks` | terraform | 1.21 ms <sub>p90 1.37 ms</sub> | 6.05 ms <sub>p90 6.85 ms</sub> | 20 ms <sub>p90 20 ms</sub> | 62 ms <sub>p90 73 ms</sub> |
| `runSimulations-losses` | annotated | 0 | 0 | 0 | 0 |
| `runSimulations-losses` | pipeline | 0 | 0 | 0 | 0 |
| `runSimulations-played` | annotated | 2 | 2 | 2 | 2 |
| `runSimulations-played` | pipeline | 2 | 2 | 2 | 2 |
| `runSimulations` | annotated | 96 ms <sub>p90 107 ms</sub> | 316 ms <sub>p90 331 ms</sub> | 766 ms <sub>p90 767 ms</sub> | 2.61 s <sub>p90 2.66 s</sub> |
| `runSimulations` | pipeline | 120 ms <sub>p90 131 ms</sub> | 315 ms <sub>p90 327 ms</sub> | 810 ms <sub>p90 910 ms</sub> | 4.28 s <sub>p90 4.85 s</sub> |

## exports

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `drawio` | annotated | 1.06 ms <sub>p90 1.26 ms</sub> | 5.99 ms <sub>p90 6.55 ms</sub> | 18 ms <sub>p90 19 ms</sub> | 56 ms <sub>p90 65 ms</sub> |
| `drawio` | examples | 1.27 ms <sub>p90 1.40 ms</sub> | 6.23 ms <sub>p90 6.90 ms</sub> | 15 ms <sub>p90 20 ms</sub> | 69 ms <sub>p90 71 ms</sub> |
| `drawio` | k8s | 0.93 ms <sub>p90 0.99 ms</sub> | 5.19 ms <sub>p90 5.79 ms</sub> | 16 ms <sub>p90 17 ms</sub> | 52 ms <sub>p90 59 ms</sub> |
| `drawio` | mesh | 0.70 ms <sub>p90 0.71 ms</sub> | 6.72 ms <sub>p90 7.04 ms</sub> | 21 ms <sub>p90 21 ms</sub> | 69 ms <sub>p90 72 ms</sub> |
| `drawio` | pipeline | 0.89 ms <sub>p90 0.92 ms</sub> | 4.22 ms <sub>p90 4.53 ms</sub> | 15 ms <sub>p90 15 ms</sub> | 49 ms <sub>p90 52 ms</sub> |
| `drawio` | terraform | 0.64 ms <sub>p90 0.72 ms</sub> | 3.56 ms <sub>p90 3.98 ms</sub> | 11 ms <sub>p90 12 ms</sub> | 39 ms <sub>p90 42 ms</sub> |
| `interactiveHtml-bytes` | annotated | 1,559,699 | 1,681,866 | 1,980,658 | 3,044,009 |
| `interactiveHtml-bytes` | examples | 1,608,439 | 1,817,797 | 2,163,963 | 3,386,173 |
| `interactiveHtml-bytes` | k8s | 1,520,034 | 1,631,480 | 1,913,618 | 2,901,851 |
| `interactiveHtml-bytes` | mesh | 1,546,660 | 1,678,762 | 1,995,967 | 3,136,293 |
| `interactiveHtml-bytes` | pipeline | 1,555,449 | 1,659,428 | 1,911,345 | 2,810,008 |
| `interactiveHtml-bytes` | terraform | 1,505,020 | 1,567,188 | 1,727,172 | 2,292,817 |
| `interactiveHtml` | annotated | 0.72 ms <sub>p90 0.76 ms</sub> | 1.52 ms <sub>p90 1.61 ms</sub> | 3.01 ms <sub>p90 3.32 ms</sub> | 8.97 ms <sub>p90 10 ms</sub> |
| `interactiveHtml` | examples | 1.10 ms <sub>p90 1.13 ms</sub> | 2.52 ms <sub>p90 2.57 ms</sub> | 4.93 ms <sub>p90 5.29 ms</sub> | 14 ms <sub>p90 14 ms</sub> |
| `interactiveHtml` | k8s | 0.46 ms <sub>p90 0.47 ms</sub> | 0.78 ms <sub>p90 0.82 ms</sub> | 1.45 ms <sub>p90 1.67 ms</sub> | 4.15 ms <sub>p90 4.75 ms</sub> |
| `interactiveHtml` | mesh | 0.50 ms <sub>p90 0.52 ms</sub> | 1.44 ms <sub>p90 1.47 ms</sub> | 3.28 ms <sub>p90 3.38 ms</sub> | 9.86 ms <sub>p90 10 ms</sub> |
| `interactiveHtml` | pipeline | 0.71 ms <sub>p90 0.75 ms</sub> | 1.30 ms <sub>p90 1.34 ms</sub> | 2.54 ms <sub>p90 2.71 ms</sub> | 7.85 ms <sub>p90 7.95 ms</sub> |
| `interactiveHtml` | terraform | 0.42 ms <sub>p90 0.45 ms</sub> | 0.58 ms <sub>p90 0.64 ms</sub> | 1.03 ms <sub>p90 1.08 ms</sub> | 2.75 ms <sub>p90 2.89 ms</sub> |
| `mermaid` | annotated | 0.21 ms <sub>p90 0.24 ms</sub> | 1.37 ms <sub>p90 1.57 ms</sub> | 7.72 ms <sub>p90 8.37 ms</sub> | 48 ms <sub>p90 53 ms</sub> |
| `mermaid` | examples | 0.27 ms <sub>p90 0.31 ms</sub> | 1.96 ms <sub>p90 2.01 ms</sub> | 9.55 ms <sub>p90 10 ms</sub> | 65 ms <sub>p90 66 ms</sub> |
| `mermaid` | k8s | 0.25 ms <sub>p90 0.27 ms</sub> | 1.37 ms <sub>p90 1.47 ms</sub> | 5.83 ms <sub>p90 6.21 ms</sub> | 24 ms <sub>p90 27 ms</sub> |
| `mermaid` | mesh | 0.12 ms <sub>p90 0.22 ms</sub> | 1.33 ms <sub>p90 1.38 ms</sub> | 6.45 ms <sub>p90 6.49 ms</sub> | 35 ms <sub>p90 38 ms</sub> |
| `mermaid` | pipeline | 0.11 ms <sub>p90 0.17 ms</sub> | 0.93 ms <sub>p90 1.02 ms</sub> | 3.93 ms <sub>p90 4.21 ms</sub> | 22 ms <sub>p90 22 ms</sub> |
| `mermaid` | terraform | 0.16 ms <sub>p90 0.18 ms</sub> | 0.89 ms <sub>p90 0.99 ms</sub> | 3.60 ms <sub>p90 3.76 ms</sub> | 15 ms <sub>p90 18 ms</sub> |
| `shareDecode` | annotated | 0.98 ms <sub>p90 1.11 ms</sub> | 2.98 ms <sub>p90 3.71 ms</sub> | 9.17 ms <sub>p90 14 ms</sub> | 31 ms <sub>p90 39 ms</sub> |
| `shareDecode` | examples | 0.77 ms <sub>p90 0.85 ms</sub> | 2.92 ms <sub>p90 5.39 ms</sub> | 13 ms <sub>p90 17 ms</sub> | 40 ms <sub>p90 44 ms</sub> |
| `shareDecode` | k8s | 0.54 ms <sub>p90 0.69 ms</sub> | 2.71 ms <sub>p90 3.60 ms</sub> | 8.02 ms <sub>p90 13 ms</sub> | 27 ms <sub>p90 35 ms</sub> |
| `shareDecode` | mesh | 1.14 ms <sub>p90 1.64 ms</sub> | 3.76 ms <sub>p90 3.98 ms</sub> | 10 ms <sub>p90 13 ms</sub> | 34 ms <sub>p90 37 ms</sub> |
| `shareDecode` | pipeline | 0.59 ms <sub>p90 0.72 ms</sub> | 2.87 ms <sub>p90 3.16 ms</sub> | 7.86 ms <sub>p90 10 ms</sub> | 24 ms <sub>p90 26 ms</sub> |
| `shareDecode` | terraform | 0.40 ms <sub>p90 0.58 ms</sub> | 1.32 ms <sub>p90 2.21 ms</sub> | 4.54 ms <sub>p90 5.65 ms</sub> | 14 ms <sub>p90 15 ms</sub> |
| `shareEncode` | annotated | 0.92 ms <sub>p90 1.00 ms</sub> | 2.60 ms <sub>p90 2.81 ms</sub> | 6.21 ms <sub>p90 6.77 ms</sub> | 20 ms <sub>p90 24 ms</sub> |
| `shareEncode` | examples | 0.82 ms <sub>p90 1.12 ms</sub> | 4.09 ms <sub>p90 4.53 ms</sub> | 14 ms <sub>p90 17 ms</sub> | 44 ms <sub>p90 48 ms</sub> |
| `shareEncode` | k8s | 0.59 ms <sub>p90 0.72 ms</sub> | 2.05 ms <sub>p90 2.35 ms</sub> | 5.56 ms <sub>p90 6.28 ms</sub> | 17 ms <sub>p90 21 ms</sub> |
| `shareEncode` | mesh | 1.04 ms <sub>p90 1.14 ms</sub> | 2.37 ms <sub>p90 2.48 ms</sub> | 7.53 ms <sub>p90 9.37 ms</sub> | 30 ms <sub>p90 30 ms</sub> |
| `shareEncode` | pipeline | 0.55 ms <sub>p90 0.67 ms</sub> | 2.06 ms <sub>p90 2.13 ms</sub> | 5.69 ms <sub>p90 6.32 ms</sub> | 18 ms <sub>p90 19 ms</sub> |
| `shareEncode` | terraform | 0.39 ms <sub>p90 0.56 ms</sub> | 1.25 ms <sub>p90 1.43 ms</sub> | 3.97 ms <sub>p90 4.89 ms</sub> | 11 ms <sub>p90 14 ms</sub> |
| `shareLink-chars` | annotated | 5,576 | 19,780 | 54,548 | 171,275 |
| `shareLink-chars` | examples | 9,498 | 42,622 | 124,523 | 411,222 |
| `shareLink-chars` | k8s | 3,910 | 15,995 | 46,191 | 157,499 |
| `shareLink-chars` | mesh | 4,679 | 19,591 | 55,511 | 180,198 |
| `shareLink-chars` | pipeline | 4,638 | 16,672 | 45,864 | 144,871 |
| `shareLink-chars` | terraform | 2,410 | 10,516 | 31,632 | 104,515 |
| `thumbnail` | annotated | 0.01 ms <sub>p90 0.01 ms</sub> | 0.02 ms <sub>p90 0.03 ms</sub> | 0.05 ms <sub>p90 0.06 ms</sub> | 0.20 ms <sub>p90 0.21 ms</sub> |
| `thumbnail` | examples | 0.01 ms <sub>p90 0.01 ms</sub> | 0.02 ms <sub>p90 0.02 ms</sub> | 0.04 ms <sub>p90 0.05 ms</sub> | 0.18 ms <sub>p90 0.18 ms</sub> |
| `thumbnail` | k8s | 0.01 ms <sub>p90 0.01 ms</sub> | 0.01 ms <sub>p90 0.01 ms</sub> | 0.05 ms <sub>p90 0.06 ms</sub> | 0.20 ms <sub>p90 0.21 ms</sub> |
| `thumbnail` | mesh | 0.01 ms <sub>p90 0.01 ms</sub> | 0.03 ms <sub>p90 0.03 ms</sub> | 0.06 ms <sub>p90 0.06 ms</sub> | 0.20 ms <sub>p90 0.21 ms</sub> |
| `thumbnail` | pipeline | 0.01 ms <sub>p90 0.01 ms</sub> | 0.02 ms <sub>p90 0.02 ms</sub> | 0.04 ms <sub>p90 0.04 ms</sub> | 0.12 ms <sub>p90 0.13 ms</sub> |
| `thumbnail` | terraform | 0.01 ms <sub>p90 0.01 ms</sub> | 0.02 ms <sub>p90 0.02 ms</sub> | 0.03 ms <sub>p90 0.04 ms</sub> | 0.11 ms <sub>p90 0.13 ms</sub> |

## features

| Metric | Workload | 100 | 500 | 1500 |
| --- | ---: | ---: | ---: | ---: |
| `autoLayout-longestFrame` | pipeline | 131 ms | 750 ms | 3.55 s |
| `autoLayout-mainThread` | pipeline | 177 ms | 1.33 s | 5.08 s |
| `autoLayout` | pipeline | 182 ms | 932 ms | 3.89 s |
| `exportHtml-longestFrame` | pipeline | 84 ms | 251 ms | 741 ms |
| `exportHtml-mainThread` | pipeline | 182 ms | 368 ms | 1.01 s |
| `exportHtml` | pipeline | 362 ms | 347 ms | 962 ms |
| `exportPng-longestFrame` | pipeline | 2.10 s | 10.12 s | 30.23 s |
| `exportPng-mainThread` | pipeline | 3.93 s | 17.23 s | 49.89 s |
| `exportPng` | pipeline | 4.21 s | 17.67 s | 51.18 s |
| `exportSvg-longestFrame` | pipeline | 2.05 s | 10.15 s | 35.02 s |
| `exportSvg-mainThread` | pipeline | 2.65 s | 12.94 s | 44.10 s |
| `exportSvg` | pipeline | 2.70 s | 12.91 s | 43.99 s |
| `language-longestFrame` | pipeline | 132 ms | 310 ms | 734 ms |
| `language-mainThread` | pipeline | 142 ms | 439 ms | 1.29 s |
| `language` | pipeline | 200 ms | 471 ms | 1.28 s |
| `runSimulations-longestFrame` | pipeline | 0.00 ms | 105 ms | 253 ms |
| `runSimulations-mainThread` | pipeline | 169 ms | 313 ms | 1000 ms |
| `runSimulations` | pipeline | 222 ms | 512 ms | 1.06 s |
| `tidy-longestFrame` | pipeline | 61 ms | 432 ms | 2.72 s |
| `tidy-mainThread` | pipeline | 83 ms | 601 ms | 3.27 s |
| `tidy` | pipeline | 94 ms | 585 ms | 3.46 s |

## imports

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `import-drawnNodes` | asyncapi | 99 | 201 | 201 | 201 |
| `import-drawnNodes` | compose | 100 | 498 | 1,500 | 4,999 |
| `import-drawnNodes` | kubernetes | 99 | 275 | 286 | 498 |
| `import-drawnNodes` | terraform | 102 | 501 | 1,501 | 4,996 |
| `import-sourceChars` | asyncapi | 41,988 | 85,814 | 85,814 | 85,814 |
| `import-sourceChars` | compose | 16,104 | 88,310 | 270,977 | 921,311 |
| `import-sourceChars` | kubernetes | 55,344 | 281,502 | 851,715 | 2,855,028 |
| `import-sourceChars` | terraform | 125,299 | 615,869 | 1,852,325 | 6,182,585 |
| `import` | asyncapi | 95 ms <sub>p90 109 ms</sub> | 190 ms <sub>p90 209 ms</sub> | 163 ms <sub>p90 184 ms</sub> | 182 ms <sub>p90 199 ms</sub> |
| `import` | compose | 63 ms <sub>p90 79 ms</sub> | 335 ms <sub>p90 359 ms</sub> | 1.00 s <sub>p90 1.20 s</sub> | 3.23 s <sub>p90 4.35 s</sub> |
| `import` | kubernetes | 146 ms <sub>p90 202 ms</sub> | 526 ms <sub>p90 891 ms</sub> | 946 ms <sub>p90 983 ms</sub> | 4.56 s <sub>p90 5.03 s</sub> |
| `import` | terraform | 4.46 ms <sub>p90 5.30 ms</sub> | 22 ms <sub>p90 23 ms</sub> | 86 ms <sub>p90 107 ms</sub> | 264 ms <sub>p90 442 ms</sub> |
| `importEverything` | asyncapi | 90 ms <sub>p90 98 ms</sub> | 179 ms <sub>p90 208 ms</sub> | 179 ms <sub>p90 190 ms</sub> | 174 ms <sub>p90 191 ms</sub> |
| `importEverything` | compose | 65 ms <sub>p90 79 ms</sub> | 221 ms <sub>p90 315 ms</sub> | 1.10 s <sub>p90 1.13 s</sub> | 7.39 s <sub>p90 9.34 s</sub> |
| `importEverything` | kubernetes | 121 ms <sub>p90 189 ms</sub> | 515 ms <sub>p90 639 ms</sub> | 1.03 s <sub>p90 1.13 s</sub> | 4.70 s <sub>p90 5.39 s</sub> |
| `importEverything` | terraform | 4.38 ms <sub>p90 4.89 ms</sub> | 20 ms <sub>p90 23 ms</sub> | 68 ms <sub>p90 71 ms</sub> | 295 ms <sub>p90 436 ms</sub> |
| `read` | asyncapi | 63 ms <sub>p90 75 ms</sub> | 125 ms <sub>p90 140 ms</sub> | 111 ms <sub>p90 122 ms</sub> | 105 ms <sub>p90 121 ms</sub> |
| `read` | compose | 68 ms <sub>p90 72 ms</sub> | 206 ms <sub>p90 242 ms</sub> | 1.00 s <sub>p90 1.06 s</sub> | 7.34 s <sub>p90 7.77 s</sub> |
| `read` | kubernetes | 155 ms <sub>p90 219 ms</sub> | 484 ms <sub>p90 558 ms</sub> | 1.33 s <sub>p90 1.59 s</sub> | 3.14 s <sub>p90 4.46 s</sub> |
| `read` | terraform | 2.40 ms <sub>p90 2.98 ms</sub> | 10 ms <sub>p90 12 ms</sub> | 38 ms <sub>p90 45 ms</sub> | 129 ms <sub>p90 143 ms</sub> |

## interact

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `drag-frameP90` | annotated |  |  | 8.05 s |  |
| `drag-frameP90` | mesh | 67 ms <sub>p90 67 ms</sub> | 467 ms <sub>p90 483 ms</sub> | 3.53 s <sub>p90 4.52 s</sub> |  |
| `drag-frameP90` | pipeline | 17 ms <sub>p90 17 ms</sub> | 83 ms <sub>p90 83 ms</sub> | 333 ms <sub>p90 433 ms</sub> | 1.29 s |
| `drag-inputToPaint` | annotated |  |  | 355 ms <sub>p90 459 ms</sub> |  |
| `drag-inputToPaint` | mesh | 37 ms <sub>p90 49 ms</sub> | 102 ms <sub>p90 139 ms</sub> | 209 ms <sub>p90 299 ms</sub> |  |
| `drag-inputToPaint` | pipeline | 26 ms <sub>p90 29 ms</sub> | 65 ms <sub>p90 94 ms</sub> | 159 ms <sub>p90 270 ms</sub> | 551 ms <sub>p90 687 ms</sub> |
| `drag-longestFrame` | annotated |  |  | 11.05 s |  |
| `drag-longestFrame` | mesh | 97 ms <sub>p90 102 ms</sub> | 799 ms <sub>p90 1.05 s</sub> | 6.32 s <sub>p90 6.45 s</sub> |  |
| `drag-longestFrame` | pipeline | 50 ms <sub>p90 65 ms</sub> | 179 ms <sub>p90 185 ms</sub> | 585 ms <sub>p90 743 ms</sub> | 1.35 s |
| `drag-taskMsPerStep` | annotated |  |  | 8.43 s |  |
| `drag-taskMsPerStep` | mesh | 130 ms <sub>p90 130 ms</sub> | 664 ms <sub>p90 730 ms</sub> | 4.34 s <sub>p90 5.14 s</sub> |  |
| `drag-taskMsPerStep` | pipeline | 47 ms <sub>p90 47 ms</sub> | 174 ms <sub>p90 174 ms</sub> | 620 ms <sub>p90 871 ms</sub> | 2.54 s |
| `pan-frameP90` | annotated |  |  | 550 ms |  |
| `pan-frameP90` | mesh | 17 ms <sub>p90 17 ms</sub> | 33 ms <sub>p90 33 ms</sub> | 283 ms <sub>p90 333 ms</sub> |  |
| `pan-frameP90` | pipeline | 17 ms <sub>p90 17 ms</sub> | 83 ms <sub>p90 83 ms</sub> | 200 ms <sub>p90 217 ms</sub> | 308 ms |
| `pan-inputToPaint` | annotated |  |  | 301 ms <sub>p90 921 ms</sub> |  |
| `pan-inputToPaint` | mesh | 22 ms <sub>p90 25 ms</sub> | 46 ms <sub>p90 164 ms</sub> | 124 ms <sub>p90 494 ms</sub> |  |
| `pan-inputToPaint` | pipeline | 20 ms <sub>p90 44 ms</sub> | 80 ms <sub>p90 126 ms</sub> | 104 ms <sub>p90 409 ms</sub> | 242 ms <sub>p90 1.01 s</sub> |
| `pan-longestFrame` | annotated |  |  | 763 ms |  |
| `pan-longestFrame` | mesh | 63 ms <sub>p90 72 ms</sub> | 147 ms <sub>p90 161 ms</sub> | 418 ms <sub>p90 463 ms</sub> |  |
| `pan-longestFrame` | pipeline | 0.00 ms <sub>p90 54 ms</sub> | 109 ms <sub>p90 124 ms</sub> | 291 ms <sub>p90 458 ms</sub> | 824 ms |
| `pan-taskMsPerStep` | annotated |  |  | 696 ms |  |
| `pan-taskMsPerStep` | mesh | 21 ms <sub>p90 26 ms</sub> | 91 ms <sub>p90 95 ms</sub> | 371 ms <sub>p90 380 ms</sub> |  |
| `pan-taskMsPerStep` | pipeline | 19 ms <sub>p90 25 ms</sub> | 104 ms <sub>p90 105 ms</sub> | 281 ms <sub>p90 375 ms</sub> | 710 ms |
| `select-first` | annotated |  |  | 1.75 s |  |
| `select-first` | mesh | 92 ms <sub>p90 123 ms</sub> | 462 ms <sub>p90 520 ms</sub> | 836 ms <sub>p90 1.09 s</sub> |  |
| `select-first` | pipeline | 86 ms <sub>p90 90 ms</sub> | 260 ms <sub>p90 327 ms</sub> | 746 ms <sub>p90 845 ms</sub> | 3.12 s |
| `select` | annotated |  |  | 1.68 s |  |
| `select` | mesh | 117 ms <sub>p90 144 ms</sub> | 395 ms <sub>p90 650 ms</sub> | 1.46 s <sub>p90 2.23 s</sub> |  |
| `select` | pipeline | 80 ms <sub>p90 85 ms</sub> | 218 ms <sub>p90 266 ms</sub> | 807 ms <sub>p90 856 ms</sub> | 3.03 s <sub>p90 4.33 s</sub> |
| `type-name-checkRuns` | annotated |  |  | 0 |  |
| `type-name-checkRuns` | mesh | 0 | 0 | 0 |  |
| `type-name-checkRuns` | pipeline | 0 | 0 | 0 | 0 |
| `type-name-event` | annotated |  |  | 768 ms <sub>p90 10.18 s</sub> |  |
| `type-name-event` | mesh | 48 ms <sub>p90 144 ms</sub> | 264 ms <sub>p90 1.26 s</sub> | 2.34 s <sub>p90 8.71 s</sub> |  |
| `type-name-event` | pipeline | 24 ms <sub>p90 32 ms</sub> | 72 ms <sub>p90 232 ms</sub> | 324 ms <sub>p90 840 ms</sub> | 1.16 s <sub>p90 4.55 s</sub> |
| `type-name-inputToPaint` | annotated |  |  | 22.11 s <sub>p90 25.03 s</sub> |  |
| `type-name-inputToPaint` | mesh | 45 ms <sub>p90 272 ms</sub> | 3.06 s <sub>p90 5.42 s</sub> | 20.05 s <sub>p90 27.05 s</sub> |  |
| `type-name-inputToPaint` | pipeline | 22 ms <sub>p90 32 ms</sub> | 76 ms <sub>p90 289 ms</sub> | 2.59 s <sub>p90 3.89 s</sub> | 12.63 s <sub>p90 16.61 s</sub> |
| `type-name-longestFrame` | annotated |  |  | 10.01 s |  |
| `type-name-longestFrame` | mesh | 133 ms <sub>p90 182 ms</sub> | 758 ms <sub>p90 1.06 s</sub> | 5.01 s <sub>p90 5.84 s</sub> |  |
| `type-name-longestFrame` | pipeline | 0.00 ms <sub>p90 0.00 ms</sub> | 201 ms <sub>p90 218 ms</sub> | 648 ms <sub>p90 718 ms</sub> | 2.57 s |
| `type-name-planningAnalyses` | annotated |  |  | 0 |  |
| `type-name-planningAnalyses` | mesh | 0 | 0 | 0 |  |
| `type-name-planningAnalyses` | pipeline | 0 | 0 | 0 | 0 |
| `type-name-planningReads` | annotated |  |  | 0 |  |
| `type-name-planningReads` | mesh | 0 | 0 | 0 |  |
| `type-name-planningReads` | pipeline | 0 | 0 | 0 | 0 |
| `type-name-taskMsPerKey` | annotated |  |  | 2.14 s |  |
| `type-name-taskMsPerKey` | mesh | 70 ms <sub>p90 87 ms</sub> | 344 ms <sub>p90 520 ms</sub> | 2.31 s <sub>p90 2.33 s</sub> |  |
| `type-name-taskMsPerKey` | pipeline | 25 ms <sub>p90 28 ms</sub> | 102 ms <sub>p90 109 ms</sub> | 361 ms <sub>p90 363 ms</sub> | 1.48 s |
| `type-number-inputToPaint` | annotated |  |  | 999 ms <sub>p90 1.58 s</sub> |  |
| `type-number-inputToPaint` | mesh | 38 ms <sub>p90 45 ms</sub> | 230 ms <sub>p90 696 ms</sub> | 906 ms <sub>p90 1.50 s</sub> |  |
| `type-number-inputToPaint` | pipeline | 21 ms <sub>p90 25 ms</sub> | 63 ms <sub>p90 78 ms</sub> | 594 ms <sub>p90 988 ms</sub> | 2.61 s <sub>p90 4.46 s</sub> |
| `type-number-planningAnalyses` | annotated |  |  | 0 |  |
| `type-number-planningAnalyses` | mesh | 0 | 0 | 0 |  |
| `type-number-planningAnalyses` | pipeline | 0 | 0 | 0 | 0 |
| `type-number-taskMsPerKey` | annotated |  |  | 404 ms |  |
| `type-number-taskMsPerKey` | mesh | 42 ms <sub>p90 46 ms</sub> | 147 ms <sub>p90 221 ms</sub> | 319 ms <sub>p90 506 ms</sub> |  |
| `type-number-taskMsPerKey` | pipeline | 27 ms <sub>p90 28 ms</sub> | 68 ms <sub>p90 78 ms</sub> | 252 ms <sub>p90 262 ms</sub> | 1.10 s |
| `type-sublabel-inputToPaint` | annotated |  |  | 2.17 s <sub>p90 3.88 s</sub> |  |
| `type-sublabel-inputToPaint` | mesh | 38 ms <sub>p90 46 ms</sub> | 516 ms <sub>p90 1.60 s</sub> | 1.89 s <sub>p90 3.70 s</sub> |  |
| `type-sublabel-inputToPaint` | pipeline | 20 ms <sub>p90 27 ms</sub> | 71 ms <sub>p90 82 ms</sub> | 1.33 s <sub>p90 2.19 s</sub> | 5.79 s <sub>p90 11.92 s</sub> |
| `type-sublabel-taskMsPerKey` | annotated |  |  | 435 ms |  |
| `type-sublabel-taskMsPerKey` | mesh | 46 ms <sub>p90 48 ms</sub> | 142 ms <sub>p90 227 ms</sub> | 327 ms <sub>p90 530 ms</sub> |  |
| `type-sublabel-taskMsPerKey` | pipeline | 23 ms <sub>p90 26 ms</sub> | 79 ms <sub>p90 83 ms</sub> | 273 ms <sub>p90 273 ms</sub> | 1.22 s |
| `zoom-frameP90` | annotated |  |  | 233 ms |  |
| `zoom-frameP90` | mesh | 17 ms <sub>p90 17 ms</sub> | 50 ms <sub>p90 50 ms</sub> | 150 ms <sub>p90 150 ms</sub> |  |
| `zoom-frameP90` | pipeline | 17 ms <sub>p90 17 ms</sub> | 17 ms <sub>p90 33 ms</sub> | 83 ms <sub>p90 83 ms</sub> | 250 ms |
| `zoom-inputToPaint` | annotated |  |  | 349 ms <sub>p90 624 ms</sub> |  |
| `zoom-inputToPaint` | mesh | 42 ms <sub>p90 44 ms</sub> | 104 ms <sub>p90 130 ms</sub> | 265 ms <sub>p90 330 ms</sub> |  |
| `zoom-inputToPaint` | pipeline | 40 ms <sub>p90 57 ms</sub> | 64 ms <sub>p90 70 ms</sub> | 158 ms <sub>p90 220 ms</sub> | 436 ms <sub>p90 589 ms</sub> |
| `zoom-longestFrame` | annotated |  |  | 269 ms |  |
| `zoom-longestFrame` | mesh | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 149 ms <sub>p90 152 ms</sub> |  |
| `zoom-longestFrame` | pipeline | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 82 ms <sub>p90 89 ms</sub> | 180 ms |
| `zoom-taskMsPerStep` | annotated |  |  | 561 ms |  |
| `zoom-taskMsPerStep` | mesh | 16 ms <sub>p90 17 ms</sub> | 123 ms <sub>p90 123 ms</sub> | 368 ms <sub>p90 376 ms</sub> |  |
| `zoom-taskMsPerStep` | pipeline | 17 ms <sub>p90 17 ms</sub> | 33 ms <sub>p90 39 ms</sub> | 182 ms <sub>p90 197 ms</sub> | 422 ms |

## layout

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `autoLayout` | annotated | 0.26 ms <sub>p90 0.27 ms</sub> | 1.56 ms <sub>p90 1.66 ms</sub> | 5.93 ms <sub>p90 6.19 ms</sub> | 19 ms <sub>p90 20 ms</sub> |
| `autoLayout` | examples | 0.27 ms <sub>p90 0.29 ms</sub> | 1.25 ms <sub>p90 1.72 ms</sub> | 6.01 ms <sub>p90 6.56 ms</sub> | 22 ms <sub>p90 27 ms</sub> |
| `autoLayout` | k8s | 0.23 ms <sub>p90 0.25 ms</sub> | 1.55 ms <sub>p90 1.63 ms</sub> | 5.46 ms <sub>p90 5.76 ms</sub> | 27 ms <sub>p90 30 ms</sub> |
| `autoLayout` | mesh | 0.21 ms <sub>p90 0.26 ms</sub> | 1.43 ms <sub>p90 1.59 ms</sub> | 5.01 ms <sub>p90 5.09 ms</sub> | 26 ms <sub>p90 30 ms</sub> |
| `autoLayout` | pipeline | 0.21 ms <sub>p90 0.24 ms</sub> | 1.32 ms <sub>p90 1.44 ms</sub> | 4.12 ms <sub>p90 4.81 ms</sub> | 19 ms <sub>p90 21 ms</sub> |
| `autoLayout` | terraform | 0.21 ms <sub>p90 0.22 ms</sub> | 1.28 ms <sub>p90 1.31 ms</sub> | 2.96 ms <sub>p90 3.32 ms</sub> | 12 ms <sub>p90 14 ms</sub> |
| `routeAll` | annotated | 17 ms <sub>p90 26 ms</sub> | 138 ms <sub>p90 147 ms</sub> | 630 ms <sub>p90 642 ms</sub> | 5.34 s <sub>p90 6.35 s</sub> |
| `routeAll` | examples | 9.50 ms <sub>p90 13 ms</sub> | 111 ms <sub>p90 132 ms</sub> | 762 ms <sub>p90 829 ms</sub> | 3.21 s <sub>p90 3.54 s</sub> |
| `routeAll` | k8s | 197 ms <sub>p90 205 ms</sub> | 2.63 s <sub>p90 3.70 s</sub> | 33.28 s |  |
| `routeAll` | mesh | 45 ms <sub>p90 56 ms</sub> | 347 ms <sub>p90 414 ms</sub> | 2.47 s <sub>p90 5.10 s</sub> |  |
| `routeAll` | pipeline | 9.26 ms <sub>p90 10 ms</sub> | 90 ms <sub>p90 103 ms</sub> | 390 ms <sub>p90 423 ms</sub> | 3.65 s <sub>p90 3.93 s</sub> |
| `routeAll` | terraform | 39 ms <sub>p90 41 ms</sub> | 382 ms <sub>p90 412 ms</sub> | 2.84 s <sub>p90 3.43 s</sub> | 77.08 s |
| `routeDragFrame-edgesRouted` | annotated | 3.90 | 6.90 | 7.80 | 5.80 |
| `routeDragFrame-edgesRouted` | examples | 3 | 10 | 9 | 30 |
| `routeDragFrame-edgesRouted` | k8s | 21.70 | 39.30 | 87 |  |
| `routeDragFrame-edgesRouted` | mesh | 18 | 40.50 | 28 |  |
| `routeDragFrame-edgesRouted` | pipeline | 4.90 | 7.90 | 5.80 | 7.70 |
| `routeDragFrame-edgesRouted` | terraform | 52.80 | 76 | 134 | 465 |
| `routeDragFrame` | annotated | 3.63 ms <sub>p90 4.05 ms</sub> | 30 ms <sub>p90 31 ms</sub> | 127 ms <sub>p90 136 ms</sub> | 836 ms <sub>p90 907 ms</sub> |
| `routeDragFrame` | examples | 2.42 ms <sub>p90 2.77 ms</sub> | 35 ms <sub>p90 46 ms</sub> | 275 ms <sub>p90 283 ms</sub> | 447 ms <sub>p90 490 ms</sub> |
| `routeDragFrame` | k8s | 114 ms <sub>p90 127 ms</sub> | 1.72 s <sub>p90 1.77 s</sub> | 8.19 s <sub>p90 12.26 s</sub> |  |
| `routeDragFrame` | mesh | 37 ms <sub>p90 41 ms</sub> | 203 ms <sub>p90 215 ms</sub> | 972 ms <sub>p90 1.09 s</sub> |  |
| `routeDragFrame` | pipeline | 4.73 ms <sub>p90 5.44 ms</sub> | 22 ms <sub>p90 24 ms</sub> | 93 ms <sub>p90 98 ms</sub> | 867 ms <sub>p90 949 ms</sub> |
| `routeDragFrame` | terraform | 22 ms <sub>p90 26 ms</sub> | 149 ms <sub>p90 172 ms</sub> | 1.02 s <sub>p90 1.14 s</sub> | 24.01 s |
| `routeSkipped` | k8s |  |  |  | 1 |
| `routeSkipped` | mesh |  |  |  | 1 |
| `tidyAll` | annotated | 0.49 ms <sub>p90 0.53 ms</sub> | 2.67 ms <sub>p90 2.87 ms</sub> | 10 ms <sub>p90 11 ms</sub> | 42 ms <sub>p90 45 ms</sub> |
| `tidyAll` | examples | 0.40 ms <sub>p90 0.43 ms</sub> | 2.38 ms <sub>p90 2.62 ms</sub> | 9.08 ms <sub>p90 10 ms</sub> | 39 ms <sub>p90 43 ms</sub> |
| `tidyAll` | k8s | 0.41 ms <sub>p90 0.49 ms</sub> | 2.45 ms <sub>p90 2.68 ms</sub> | 8.22 ms <sub>p90 8.68 ms</sub> | 40 ms <sub>p90 42 ms</sub> |
| `tidyAll` | mesh | 0.32 ms <sub>p90 0.35 ms</sub> | 2.27 ms <sub>p90 2.52 ms</sub> | 7.42 ms <sub>p90 7.95 ms</sub> | 44 ms <sub>p90 46 ms</sub> |
| `tidyAll` | pipeline | 0.38 ms <sub>p90 0.40 ms</sub> | 2.14 ms <sub>p90 2.28 ms</sub> | 7.83 ms <sub>p90 8.58 ms</sub> | 39 ms <sub>p90 46 ms</sub> |
| `tidyAll` | terraform | 0.42 ms <sub>p90 0.48 ms</sub> | 3.08 ms <sub>p90 3.60 ms</sub> | 17 ms <sub>p90 18 ms</sub> | 95 ms <sub>p90 109 ms</sub> |
| `tidySelection` | annotated | 0.08 ms <sub>p90 0.08 ms</sub> | 0.10 ms <sub>p90 0.11 ms</sub> | 0.15 ms <sub>p90 0.16 ms</sub> | 0.25 ms <sub>p90 0.28 ms</sub> |
| `tidySelection` | examples | 0.06 ms <sub>p90 0.07 ms</sub> | 0.10 ms <sub>p90 0.13 ms</sub> | 0.13 ms <sub>p90 0.15 ms</sub> | 0.28 ms <sub>p90 0.31 ms</sub> |
| `tidySelection` | k8s | 0.08 ms <sub>p90 0.08 ms</sub> | 0.12 ms <sub>p90 0.13 ms</sub> | 0.36 ms <sub>p90 0.39 ms</sub> | 1.43 ms <sub>p90 1.64 ms</sub> |
| `tidySelection` | mesh | 0.91 ms <sub>p90 1.08 ms</sub> | 1.65 ms <sub>p90 1.77 ms</sub> | 3.02 ms <sub>p90 3.45 ms</sub> | 2.19 ms <sub>p90 2.34 ms</sub> |
| `tidySelection` | pipeline | 0.16 ms <sub>p90 0.18 ms</sub> | 0.18 ms <sub>p90 0.20 ms</sub> | 0.18 ms <sub>p90 0.23 ms</sub> | 0.32 ms <sub>p90 0.36 ms</sub> |

## live

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `domNodesLiveGrowth60s` | pipeline |  |  | 6,108 |  |
| `dots/main/x1` | mesh | 654 | 389 | 6 |  |
| `dots/main/x1` | pipeline | 131 | 83 | 56 | 0 |
| `dots/main/x10` | mesh | 728 | 882 | 282 |  |
| `dots/main/x10` | pipeline | 262 | 552 | 585 | 90 |
| `dots/worker/x1` | mesh | 649 | 414 | 49 |  |
| `dots/worker/x1` | pipeline | 138 | 87 | 88 | 0 |
| `dots/worker/x10` | mesh | 707 | 891 | 295 |  |
| `dots/worker/x10` | pipeline | 250 | 514 | 604 | 81 |
| `fps/main/x1` | mesh | 49.60 | 3.80 | 1.40 |  |
| `fps/main/x1` | pipeline | 55.50 | 9 | 3 | 4.90 |
| `fps/main/x10` | mesh | 36 | 7.20 | 2.60 |  |
| `fps/main/x10` | pipeline | 30.80 | 6.80 | 2.90 | 1.40 |
| `fps/worker/x1` | mesh | 59.20 | 4.70 | 2.40 |  |
| `fps/worker/x1` | pipeline | 60 | 5.90 | 4.90 | 5.40 |
| `fps/worker/x10` | mesh | 60.30 | 5 | 2.20 |  |
| `fps/worker/x10` | pipeline | 40.60 | 7 | 2.90 | 1.60 |
| `heapLiveAfter60s` | pipeline |  |  | 118.36 MB |  |
| `heapLiveGrowth60s` | pipeline |  |  | 5.56 MB |  |
| `heapLiveStart` | pipeline |  |  | 112.81 MB |  |
| `longestFrame/main/x1` | mesh | 0.00 ms | 311 ms | 887 ms |  |
| `longestFrame/main/x1` | pipeline | 0.00 ms | 163 ms | 146 ms | 256 ms |
| `longestFrame/main/x10` | mesh | 0.00 ms | 184 ms | 1.45 s |  |
| `longestFrame/main/x10` | pipeline | 0.00 ms | 116 ms | 317 ms | 2.82 s |
| `longestFrame/worker/x1` | mesh | 0.00 ms | 310 ms | 999 ms |  |
| `longestFrame/worker/x1` | pipeline | 0.00 ms | 242 ms | 152 ms | 220 ms |
| `longestFrame/worker/x10` | mesh | 0.00 ms | 277 ms | 1.84 s |  |
| `longestFrame/worker/x10` | pipeline | 60 ms | 131 ms | 319 ms | 2.73 s |
| `mainBusyPct/main/x1` | mesh | 100 ms | 99 ms | 100 ms |  |
| `mainBusyPct/main/x1` | pipeline | 81 ms | 97 ms | 100 ms | 100 ms |
| `mainBusyPct/main/x10` | mesh | 100 ms | 98 ms | 99 ms |  |
| `mainBusyPct/main/x10` | pipeline | 98 ms | 97 ms | 99 ms | 100 ms |
| `mainBusyPct/worker/x1` | mesh | 62 ms | 97 ms | 97 ms |  |
| `mainBusyPct/worker/x1` | pipeline | 29 ms | 95 ms | 98 ms | 100 ms |
| `mainBusyPct/worker/x10` | mesh | 65 ms | 100 ms | 100 ms |  |
| `mainBusyPct/worker/x10` | pipeline | 95 ms | 96 ms | 96 ms | 100 ms |
| `mainMsPerFrame/main/x1` | mesh | 20 ms | 261 ms | 720 ms |  |
| `mainMsPerFrame/main/x1` | pipeline | 15 ms | 108 ms | 334 ms | 202 ms |
| `mainMsPerFrame/main/x10` | mesh | 28 ms | 136 ms | 385 ms |  |
| `mainMsPerFrame/main/x10` | pipeline | 32 ms | 142 ms | 336 ms | 716 ms |
| `mainMsPerFrame/worker/x1` | mesh | 10 ms | 205 ms | 406 ms |  |
| `mainMsPerFrame/worker/x1` | pipeline | 4.86 ms | 160 ms | 200 ms | 186 ms |
| `mainMsPerFrame/worker/x10` | mesh | 11 ms | 200 ms | 462 ms |  |
| `mainMsPerFrame/worker/x10` | pipeline | 23 ms | 138 ms | 328 ms | 627 ms |
| `particleFps/main/x1` | mesh | 50.20 | 3.20 | 0.80 |  |
| `particleFps/main/x1` | pipeline | 56.10 | 9 | 2.80 | 0 |
| `particleFps/main/x10` | mesh | 35 | 7 | 2.40 |  |
| `particleFps/main/x10` | pipeline | 30.60 | 6.80 | 3.10 | 1.20 |
| `particleFps/worker/x1` | mesh | 59.40 | 4.30 | 1.80 |  |
| `particleFps/worker/x1` | pipeline | 60.60 | 5.50 | 4.10 | 0 |
| `particleFps/worker/x10` | mesh | 60.70 | 4.80 | 1.60 |  |
| `particleFps/worker/x10` | pipeline | 39.10 | 6.80 | 3.10 | 0.60 |
| `rendererFellBack/main/x1` | mesh | 0 | 0 | 0 |  |
| `rendererFellBack/main/x1` | pipeline | 0 | 0 | 0 | 0 |
| `rendererFellBack/main/x10` | mesh | 0 | 0 | 0 |  |
| `rendererFellBack/main/x10` | pipeline | 0 | 0 | 0 | 0 |
| `rendererFellBack/worker/x1` | mesh | 0 | 0 | 0 |  |
| `rendererFellBack/worker/x1` | pipeline | 0 | 0 | 0 | 0 |
| `rendererFellBack/worker/x10` | mesh | 0 | 0 | 0 |  |
| `rendererFellBack/worker/x10` | pipeline | 0 | 0 | 0 | 0 |

## load

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `blocking` | annotated | 334 ms <sub>p90 340 ms</sub> | 1.62 s <sub>p90 1.63 s</sub> | 7.79 s | 234.92 s |
| `blocking` | examples | 579 ms <sub>p90 642 ms</sub> | 1.85 s <sub>p90 3.08 s</sub> | 9.47 s | 17.96 s |
| `blocking` | k8s | 1.21 s <sub>p90 2.83 s</sub> | 7.00 s <sub>p90 8.99 s</sub> | 32 ms |  |
| `blocking` | mesh | 356 ms <sub>p90 381 ms</sub> | 1.42 s <sub>p90 1.49 s</sub> | 8.28 s | 155.27 s |
| `blocking` | pipeline | 501 ms <sub>p90 516 ms</sub> | 1.06 s <sub>p90 1.76 s</sub> | 2.62 s | 22.17 s |
| `blocking` | terraform | 496 ms <sub>p90 500 ms</sub> | 1.75 s <sub>p90 1.82 s</sub> | 7.47 s | 169 ms |
| `checksDone` | annotated | 1.20 s <sub>p90 1.20 s</sub> | 2.65 s <sub>p90 2.69 s</sub> |  |  |
| `checksDone` | examples | 1.68 s <sub>p90 1.79 s</sub> | 3.28 s <sub>p90 5.45 s</sub> |  |  |
| `checksDone` | k8s | 2.13 s <sub>p90 4.13 s</sub> | 8.14 s <sub>p90 10.19 s</sub> |  |  |
| `checksDone` | mesh | 1.22 s <sub>p90 1.30 s</sub> | 2.25 s <sub>p90 2.38 s</sub> |  |  |
| `checksDone` | pipeline | 1.35 s <sub>p90 1.37 s</sub> | 2.04 s <sub>p90 2.82 s</sub> |  |  |
| `checksDone` | terraform | 1.28 s <sub>p90 1.30 s</sub> | 2.72 s <sub>p90 2.73 s</sub> |  |  |
| `domNodes` | annotated | 3,565 | 13,835 | 39,611 | 129,726 |
| `domNodes` | examples | 3,740 | 13,690 | 37,973 | 123,082 |
| `domNodes` | k8s | 3,746 | 15,092 | 43,404 |  |
| `domNodes` | mesh | 3,748 | 14,796 | 41,806 | 137,034 |
| `domNodes` | pipeline | 3,202 | 11,946 | 33,814 | 110,508 |
| `domNodes` | terraform | 3,397 | 13,096 | 37,408 | 122,371 |
| `firstNode` | annotated | 639 ms <sub>p90 643 ms</sub> | 892 ms <sub>p90 906 ms</sub> | 1.46 s | 4.38 s |
| `firstNode` | examples | 777 ms <sub>p90 796 ms</sub> | 1.55 s <sub>p90 2.24 s</sub> | 4.32 s | 3.45 s |
| `firstNode` | k8s | 939 ms <sub>p90 2.22 s</sub> | 852 ms <sub>p90 1.06 s</sub> | 1.47 s |  |
| `firstNode` | mesh | 619 ms <sub>p90 661 ms</sub> | 808 ms <sub>p90 824 ms</sub> | 1.47 s | 5.00 s |
| `firstNode` | pipeline | 785 ms <sub>p90 793 ms</sub> | 866 ms <sub>p90 1.22 s</sub> | 1.29 s | 6.83 s |
| `firstNode` | terraform | 700 ms <sub>p90 706 ms</sub> | 983 ms <sub>p90 987 ms</sub> | 1.97 s | 4.15 s |
| `firstNodeTimedOut` | k8s |  |  |  | 300.00 s |
| `heapAfterLoad` | annotated | 12.84 MB | 35.91 MB | 91.78 MB | 287.79 MB |
| `heapAfterLoad` | examples | 12.38 MB | 35.01 MB | 87.12 MB | 285.61 MB |
| `heapAfterLoad` | k8s | 12.52 MB | 36.17 MB | 97.70 MB |  |
| `heapAfterLoad` | mesh | 12.85 MB | 38.00 MB | 101.37 MB | 318.23 MB |
| `heapAfterLoad` | pipeline | 11.86 MB | 32.09 MB | 79.01 MB | 247.55 MB |
| `heapAfterLoad` | terraform | 11.58 MB | 31.41 MB | 80.38 MB | 251.84 MB |
| `layout` | annotated | 157 ms <sub>p90 163 ms</sub> | 243 ms <sub>p90 245 ms</sub> | 267 ms | 879 ms |
| `layout` | examples | 226 ms <sub>p90 238 ms</sub> | 306 ms <sub>p90 452 ms</sub> | 717 ms | 715 ms |
| `layout` | k8s | 238 ms <sub>p90 588 ms</sub> | 233 ms <sub>p90 250 ms</sub> | 313 ms |  |
| `layout` | mesh | 142 ms <sub>p90 150 ms</sub> | 206 ms <sub>p90 206 ms</sub> | 304 ms | 1.01 s |
| `layout` | pipeline | 209 ms <sub>p90 223 ms</sub> | 215 ms <sub>p90 328 ms</sub> | 251 ms | 1.20 s |
| `layout` | terraform | 178 ms <sub>p90 181 ms</sub> | 257 ms <sub>p90 265 ms</sub> | 409 ms | 800 ms |
| `listeners` | annotated | 1,505 | 5,537 | 15,633 | 50,961 |
| `listeners` | examples | 1,423 | 5,118 | 14,356 | 46,695 |
| `listeners` | k8s | 1,498 | 5,565 | 15,682 |  |
| `listeners` | mesh | 1,472 | 5,389 | 15,095 | 49,180 |
| `listeners` | pipeline | 1,400 | 5,004 | 14,016 | 45,585 |
| `listeners` | terraform | 1,414 | 5,005 | 14,003 | 45,458 |
| `longestFrame` | annotated | 379 ms <sub>p90 385 ms</sub> | 1.55 s <sub>p90 1.56 s</sub> | 7.82 s | 234.67 s |
| `longestFrame` | examples | 521 ms <sub>p90 589 ms</sub> | 2.02 s <sub>p90 3.12 s</sub> | 9.40 s | 16.32 s |
| `longestFrame` | k8s | 1.21 s <sub>p90 2.63 s</sub> | 7.02 s <sub>p90 9.00 s</sub> | 83 ms |  |
| `longestFrame` | mesh | 403 ms <sub>p90 430 ms</sub> | 1.43 s <sub>p90 1.50 s</sub> | 8.29 s | 154.42 s |
| `longestFrame` | pipeline | 506 ms <sub>p90 526 ms</sub> | 1.02 s <sub>p90 1.65 s</sub> | 2.60 s | 21.58 s |
| `longestFrame` | terraform | 531 ms <sub>p90 532 ms</sub> | 1.73 s <sub>p90 1.81 s</sub> | 7.47 s | 143 ms |
| `mainThread` | annotated | 885 ms <sub>p90 912 ms</sub> | 2.63 s <sub>p90 2.67 s</sub> | 8.39 s | 237.05 s |
| `mainThread` | examples | 1.34 s <sub>p90 1.43 s</sub> | 3.23 s <sub>p90 5.51 s</sub> | 17.11 s | 47.91 s |
| `mainThread` | k8s | 2.04 s <sub>p90 4.00 s</sub> | 7.62 s <sub>p90 9.57 s</sub> | 76.21 s |  |
| `mainThread` | mesh | 866 ms <sub>p90 941 ms</sub> | 2.18 s <sub>p90 2.27 s</sub> | 9.01 s | 165.43 s |
| `mainThread` | pipeline | 1.20 s <sub>p90 1.28 s</sub> | 1.90 s <sub>p90 2.74 s</sub> | 3.75 s | 28.08 s |
| `mainThread` | terraform | 1.09 s <sub>p90 1.10 s</sub> | 2.61 s <sub>p90 2.67 s</sub> | 8.26 s | 90.28 s |
| `script` | annotated | 404 ms <sub>p90 405 ms</sub> | 1.41 s <sub>p90 1.42 s</sub> | 6.86 s | 226.10 s |
| `script` | examples | 578 ms <sub>p90 642 ms</sub> | 1.53 s <sub>p90 2.19 s</sub> | 6.35 s | 14.14 s |
| `script` | k8s | 1.26 s <sub>p90 2.51 s</sub> | 6.76 s <sub>p90 8.57 s</sub> | 74.44 s |  |
| `script` | mesh | 421 ms <sub>p90 450 ms</sub> | 1.32 s <sub>p90 1.33 s</sub> | 7.23 s | 150.17 s |
| `script` | pipeline | 543 ms <sub>p90 566 ms</sub> | 906 ms <sub>p90 1.32 s</sub> | 1.97 s | 15.49 s |
| `script` | terraform | 498 ms <sub>p90 508 ms</sub> | 1.54 s <sub>p90 1.60 s</sub> | 6.13 s | 83.46 s |
| `settled` | annotated | 822 ms <sub>p90 909 ms</sub> | 2.26 s <sub>p90 2.72 s</sub> | 8.30 s | 235.38 s |
| `settled` | examples | 1.26 s <sub>p90 1.35 s</sub> | 3.14 s <sub>p90 5.50 s</sub> | 10.58 s | 47.31 s |
| `settled` | k8s | 1.87 s <sub>p90 3.81 s</sub> | 7.50 s <sub>p90 9.55 s</sub> | 1.47 s |  |
| `settled` | mesh | 845 ms <sub>p90 986 ms</sub> | 2.04 s <sub>p90 2.11 s</sub> | 8.79 s | 164.08 s |
| `settled` | pipeline | 1.14 s <sub>p90 1.16 s</sub> | 1.70 s <sub>p90 2.61 s</sub> | 3.47 s | 27.17 s |
| `settled` | terraform | 1.01 s <sub>p90 1.01 s</sub> | 2.41 s <sub>p90 2.49 s</sub> | 8.01 s | 4.15 s |
| `styleRecalc` | annotated | 94 ms <sub>p90 99 ms</sub> | 349 ms <sub>p90 359 ms</sub> | 818 ms | 7.80 s |
| `styleRecalc` | examples | 169 ms <sub>p90 181 ms</sub> | 619 ms <sub>p90 1.07 s</sub> | 2.59 s | 2.94 s |
| `styleRecalc` | k8s | 178 ms <sub>p90 265 ms</sub> | 318 ms <sub>p90 421 ms</sub> | 891 ms |  |
| `styleRecalc` | mesh | 95 ms <sub>p90 95 ms</sub> | 295 ms <sub>p90 336 ms</sub> | 1.03 s | 4.28 s |
| `styleRecalc` | pipeline | 138 ms <sub>p90 140 ms</sub> | 324 ms <sub>p90 519 ms</sub> | 801 ms | 5.27 s |
| `styleRecalc` | terraform | 173 ms <sub>p90 174 ms</sub> | 405 ms <sub>p90 406 ms</sub> | 1.13 s | 3.36 s |

## memory

| Metric | Workload | 500 |
| --- | ---: | ---: |
| `commandPalette/domNodesFirstWindow` | pipeline | 0 |
| `commandPalette/heapPerCycle` | pipeline | 6.7 kB |
| `commandPalette/listenersFirstWindow` | pipeline | 0 |
| `exportDialog/domNodesFirstWindow` | pipeline | 0 |
| `exportDialog/heapPerCycle` | pipeline | 7.0 kB |
| `exportDialog/listenersFirstWindow` | pipeline | 0 |
| `inspector/domNodesFirstWindow` | pipeline | 0 |
| `inspector/heapPerCycle` | pipeline | 11.0 kB |
| `inspector/listenersFirstWindow` | pipeline | 0 |
| `liveView/domNodesFirstWindow` | pipeline | 0 |
| `liveView/heapPerCycle` | pipeline | 27.8 kB |
| `liveView/listenersFirstWindow` | pipeline | 0 |

## parse

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fileSize` | annotated | 56,229 | 254,857 | 747,578 | 2,489,478 |
| `fileSize` | examples | 51,624 | 262,820 | 793,851 | 2,661,955 |
| `fileSize` | k8s | 44,468 | 228,910 | 693,487 | 2,312,048 |
| `fileSize` | mesh | 52,732 | 268,527 | 797,283 | 2,686,469 |
| `fileSize` | pipeline | 49,408 | 219,727 | 638,743 | 2,124,022 |
| `fileSize` | terraform | 25,240 | 125,603 | 381,308 | 1,281,511 |
| `fromFlow` | annotated | 0.02 ms <sub>p90 0.03 ms</sub> | 0.07 ms <sub>p90 0.10 ms</sub> | 0.20 ms <sub>p90 0.27 ms</sub> | 0.68 ms <sub>p90 0.88 ms</sub> |
| `fromFlow` | examples | 0.01 ms <sub>p90 0.02 ms</sub> | 0.05 ms <sub>p90 0.06 ms</sub> | 0.17 ms <sub>p90 0.27 ms</sub> | 0.60 ms <sub>p90 1.31 ms</sub> |
| `fromFlow` | k8s | 0.01 ms <sub>p90 0.02 ms</sub> | 0.07 ms <sub>p90 0.10 ms</sub> | 0.20 ms <sub>p90 0.26 ms</sub> | 0.75 ms <sub>p90 1.32 ms</sub> |
| `fromFlow` | mesh | 0.01 ms <sub>p90 0.02 ms</sub> | 0.05 ms <sub>p90 0.09 ms</sub> | 0.15 ms <sub>p90 0.26 ms</sub> | 0.59 ms <sub>p90 1.25 ms</sub> |
| `fromFlow` | pipeline | 0.01 ms <sub>p90 0.01 ms</sub> | 0.04 ms <sub>p90 0.05 ms</sub> | 0.11 ms <sub>p90 0.18 ms</sub> | 0.46 ms <sub>p90 0.99 ms</sub> |
| `fromFlow` | terraform | 0.01 ms <sub>p90 0.02 ms</sub> | 0.04 ms <sub>p90 0.06 ms</sub> | 0.15 ms <sub>p90 0.21 ms</sub> | 0.50 ms <sub>p90 0.93 ms</sub> |
| `parseNative` | annotated | 0.44 ms <sub>p90 0.53 ms</sub> | 2.48 ms <sub>p90 2.81 ms</sub> | 5.85 ms <sub>p90 7.88 ms</sub> | 28 ms <sub>p90 28 ms</sub> |
| `parseNative` | examples | 0.36 ms <sub>p90 0.56 ms</sub> | 3.26 ms <sub>p90 3.48 ms</sub> | 11 ms <sub>p90 13 ms</sub> | 38 ms <sub>p90 41 ms</sub> |
| `parseNative` | k8s | 0.36 ms <sub>p90 0.41 ms</sub> | 2.00 ms <sub>p90 2.17 ms</sub> | 5.89 ms <sub>p90 6.34 ms</sub> | 20 ms <sub>p90 25 ms</sub> |
| `parseNative` | mesh | 0.33 ms <sub>p90 0.41 ms</sub> | 2.11 ms <sub>p90 2.60 ms</sub> | 6.87 ms <sub>p90 7.63 ms</sub> | 24 ms <sub>p90 24 ms</sub> |
| `parseNative` | pipeline | 0.42 ms <sub>p90 0.52 ms</sub> | 1.73 ms <sub>p90 2.20 ms</sub> | 5.71 ms <sub>p90 6.89 ms</sub> | 19 ms <sub>p90 21 ms</sub> |
| `parseNative` | terraform | 0.20 ms <sub>p90 0.22 ms</sub> | 0.99 ms <sub>p90 1.05 ms</sub> | 2.35 ms <sub>p90 3.02 ms</sub> | 11 ms <sub>p90 11 ms</sub> |
| `serialize` | annotated | 0.11 ms <sub>p90 0.12 ms</sub> | 0.54 ms <sub>p90 0.62 ms</sub> | 1.34 ms <sub>p90 1.62 ms</sub> | 6.22 ms <sub>p90 6.28 ms</sub> |
| `serialize` | examples | 0.13 ms <sub>p90 0.14 ms</sub> | 0.85 ms <sub>p90 0.86 ms</sub> | 2.73 ms <sub>p90 2.91 ms</sub> | 9.74 ms <sub>p90 11 ms</sub> |
| `serialize` | k8s | 0.09 ms <sub>p90 0.09 ms</sub> | 0.49 ms <sub>p90 0.52 ms</sub> | 1.38 ms <sub>p90 1.63 ms</sub> | 4.96 ms <sub>p90 5.81 ms</sub> |
| `serialize` | mesh | 0.08 ms <sub>p90 0.10 ms</sub> | 0.58 ms <sub>p90 0.68 ms</sub> | 1.93 ms <sub>p90 1.98 ms</sub> | 6.45 ms <sub>p90 7.60 ms</sub> |
| `serialize` | pipeline | 0.10 ms <sub>p90 0.11 ms</sub> | 0.47 ms <sub>p90 0.50 ms</sub> | 1.54 ms <sub>p90 1.60 ms</sub> | 5.12 ms <sub>p90 5.86 ms</sub> |
| `serialize` | terraform | 0.05 ms <sub>p90 0.05 ms</sub> | 0.25 ms <sub>p90 0.27 ms</sub> | 0.65 ms <sub>p90 0.71 ms</sub> | 2.96 ms <sub>p90 3.14 ms</sub> |
| `toFlow` | annotated | 0.15 ms <sub>p90 0.20 ms</sub> | 0.94 ms <sub>p90 1.02 ms</sub> | 2.58 ms <sub>p90 2.94 ms</sub> | 11 ms <sub>p90 11 ms</sub> |
| `toFlow` | examples | 0.17 ms <sub>p90 0.19 ms</sub> | 0.59 ms <sub>p90 0.98 ms</sub> | 3.04 ms <sub>p90 3.42 ms</sub> | 7.64 ms <sub>p90 10 ms</sub> |
| `toFlow` | k8s | 0.22 ms <sub>p90 0.26 ms</sub> | 1.13 ms <sub>p90 1.34 ms</sub> | 3.65 ms <sub>p90 3.80 ms</sub> | 12 ms <sub>p90 14 ms</sub> |
| `toFlow` | mesh | 0.15 ms <sub>p90 0.18 ms</sub> | 1.05 ms <sub>p90 1.16 ms</sub> | 3.07 ms <sub>p90 3.39 ms</sub> | 11 ms <sub>p90 12 ms</sub> |
| `toFlow` | pipeline | 0.14 ms <sub>p90 0.15 ms</sub> | 0.63 ms <sub>p90 0.69 ms</sub> | 1.94 ms <sub>p90 2.26 ms</sub> | 6.98 ms <sub>p90 7.38 ms</sub> |
| `toFlow` | terraform | 0.16 ms <sub>p90 0.19 ms</sub> | 0.82 ms <sub>p90 0.93 ms</sub> | 1.97 ms <sub>p90 2.18 ms</sub> | 7.47 ms <sub>p90 9.97 ms</sub> |

## planning

| Metric | Workload | 100 | 250 | 500 | 1500 | 5000 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 24 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `analyzeCapacity-iterations` | annotated | 8 |  | 8 | 8 | 8 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-iterations` | examples | 13 |  | 20 | 20 | 20 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-iterations` | k8s | 17 |  | 17 | 17 | 17 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-iterations` | mesh | 18 |  | 21 | 23 | 23 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-iterations` | pipeline | 8 |  | 8 | 8 | 8 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-iterations` | terraform | 2 |  | 2 | 2 | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-withLoop-iterations` | mesh-loop | 18 |  | 256 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity-withLoop` | mesh-loop | 1.77 ms <sub>p90 2.30 ms</sub> |  | 99 ms <sub>p90 107 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity` | annotated | 1.07 ms <sub>p90 1.62 ms</sub> |  | 5.49 ms <sub>p90 6.47 ms</sub> | 16 ms <sub>p90 17 ms</sub> | 54 ms <sub>p90 69 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity` | examples | 1.24 ms <sub>p90 1.42 ms</sub> |  | 9.88 ms <sub>p90 15 ms</sub> | 42 ms <sub>p90 51 ms</sub> | 422 ms <sub>p90 559 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity` | k8s | 1.09 ms <sub>p90 1.49 ms</sub> |  | 3.99 ms <sub>p90 4.65 ms</sub> | 14 ms <sub>p90 15 ms</sub> | 31 ms <sub>p90 43 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity` | mesh | 1.25 ms <sub>p90 1.34 ms</sub> |  | 8.93 ms <sub>p90 11 ms</sub> | 41 ms <sub>p90 46 ms</sub> | 186 ms <sub>p90 223 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity` | pipeline | 1.06 ms <sub>p90 1.47 ms</sub> |  | 5.50 ms <sub>p90 6.71 ms</sub> | 22 ms <sub>p90 27 ms</sub> | 80 ms <sub>p90 93 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `analyzeCapacity` | terraform | 0.60 ms <sub>p90 0.83 ms</sub> |  | 3.06 ms <sub>p90 3.72 ms</sub> | 10 ms <sub>p90 12 ms</sub> | 26 ms <sub>p90 41 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/legacy` | examples | 7.78 ms <sub>p90 8.41 ms</sub> | 51 ms <sub>p90 55 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/legacy` | mesh | 12 ms <sub>p90 13 ms</sub> | 95 ms <sub>p90 104 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/legacy` | pipeline | 11 ms <sub>p90 12 ms</sub> | 57 ms <sub>p90 70 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p1` | examples | 5.81 ms <sub>p90 8.27 ms</sub> | 50 ms <sub>p90 53 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p1` | mesh | 13 ms <sub>p90 14 ms</sub> | 91 ms <sub>p90 108 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p1` | pipeline | 11 ms <sub>p90 13 ms</sub> | 57 ms <sub>p90 68 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p2` | examples | 4.94 ms <sub>p90 5.36 ms</sub> | 35 ms <sub>p90 40 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p2` | mesh | 13 ms <sub>p90 14 ms</sub> | 74 ms <sub>p90 86 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p2` | pipeline | 10 ms <sub>p90 12 ms</sub> | 41 ms <sub>p90 55 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p3` | examples | 7.82 ms <sub>p90 9.54 ms</sub> | 47 ms <sub>p90 52 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p3` | mesh | 8.71 ms <sub>p90 9.48 ms</sub> | 85 ms <sub>p90 111 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `explainEveryNode/p3` | pipeline | 7.66 ms <sub>p90 9.26 ms</sub> | 46 ms <sub>p90 51 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-aks-app-config-key-vault |  |  |  |  |  |  |  |  |  |  |  |  | 0.77 ms <sub>p90 0.87 ms</sub> |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-autoscaling-image-workers |  |  |  |  |  | 0.85 ms <sub>p90 1.07 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-aws-fanout |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.11 ms <sub>p90 4.93 ms</sub> |  |
| `inspectorPlanning-keystroke/legacy` | example-azure-service-bus-integration |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.75 ms <sub>p90 1.34 ms</sub> |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-branch-to-datacentre |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.14 ms <sub>p90 2.57 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-cdc-analytics |  |  |  |  |  |  |  |  |  |  |  | 0.58 ms <sub>p90 1.42 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-contoso-dmz |  |  |  |  |  |  |  |  |  |  | 0.91 ms <sub>p90 1.06 ms</sub> |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-cqrs-event-sourcing |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.96 ms <sub>p90 1.16 ms</sub> |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-gcp-streaming-analytics |  |  |  |  |  |  |  |  |  |  | 0.65 ms <sub>p90 0.79 ms</sub> |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-iot-telemetry |  |  |  |  |  |  |  |  |  |  |  |  | 0.64 ms <sub>p90 0.72 ms</sub> |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-measured-order-capacity |  |  |  |  |  |  | 0.51 ms <sub>p90 0.65 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-multi-region-active-active |  |  |  |  |  |  |  |  |  | 0.62 ms <sub>p90 0.73 ms</sub> |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-nightly-batch-elt |  |  |  |  |  |  |  |  |  |  |  | 0.48 ms <sub>p90 0.63 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-notification-fanout |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.83 ms <sub>p90 1.19 ms</sub> |  |  |
| `inspectorPlanning-keystroke/legacy` | example-partitions-vs-subscriptions |  |  |  |  |  |  |  | 1.00 ms <sub>p90 1.69 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-rag-assistant |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.95 ms <sub>p90 2.08 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-serverless-burst-buffer |  |  |  |  |  |  |  |  |  | 1.19 ms <sub>p90 1.89 ms</sub> |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-shared-api-quotas |  |  |  |  |  |  |  |  | 0.81 ms <sub>p90 1.03 ms</sub> |  |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | example-shared-worker-pool |  |  |  |  |  |  |  | 0.61 ms <sub>p90 0.87 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/legacy` | mesh |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.52 ms <sub>p90 6.06 ms</sub> |
| `inspectorPlanning-keystroke/legacy` | pipeline |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.25 ms <sub>p90 1.52 ms</sub> |
| `inspectorPlanning-keystroke/p1` | example-aks-app-config-key-vault |  |  |  |  |  |  |  |  |  |  |  |  | 0.73 ms <sub>p90 0.90 ms</sub> |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-aws-fanout |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.00 ms <sub>p90 1.13 ms</sub> |  |
| `inspectorPlanning-keystroke/p1` | example-azure-service-bus-integration |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.68 ms <sub>p90 0.75 ms</sub> |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-branch-to-datacentre |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.98 ms <sub>p90 1.22 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-cdc-analytics |  |  |  |  |  |  |  |  |  |  |  | 0.52 ms <sub>p90 0.63 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-cqrs-event-sourcing |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.83 ms <sub>p90 0.92 ms</sub> |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-gcp-streaming-analytics |  |  |  |  |  |  |  |  |  |  | 0.56 ms <sub>p90 0.79 ms</sub> |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-iot-telemetry |  |  |  |  |  |  |  |  |  |  |  |  | 0.70 ms <sub>p90 0.79 ms</sub> |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-multi-region-active-active |  |  |  |  |  |  |  |  |  | 0.60 ms <sub>p90 0.74 ms</sub> |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-nightly-batch-elt |  |  |  |  |  |  |  |  |  |  |  | 0.47 ms <sub>p90 0.57 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | example-notification-fanout |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.84 ms <sub>p90 0.92 ms</sub> |  |  |
| `inspectorPlanning-keystroke/p1` | example-rag-assistant |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.86 ms <sub>p90 1.14 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/p1` | mesh |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.37 ms <sub>p90 1.60 ms</sub> |
| `inspectorPlanning-keystroke/p1` | pipeline |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.26 ms <sub>p90 1.62 ms</sub> |
| `inspectorPlanning-keystroke/p2` | example-aks-app-config-key-vault |  |  |  |  |  |  |  |  |  |  |  |  | 0.64 ms <sub>p90 0.77 ms</sub> |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-aws-fanout |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.99 ms <sub>p90 1.18 ms</sub> |  |
| `inspectorPlanning-keystroke/p2` | example-azure-service-bus-integration |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.72 ms <sub>p90 0.78 ms</sub> |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-branch-to-datacentre |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.93 ms <sub>p90 1.09 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-cdc-analytics |  |  |  |  |  |  |  |  |  |  |  | 0.49 ms <sub>p90 0.53 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-cqrs-event-sourcing |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.81 ms <sub>p90 0.97 ms</sub> |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-gcp-streaming-analytics |  |  |  |  |  |  |  |  |  |  | 0.57 ms <sub>p90 0.68 ms</sub> |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-iot-telemetry |  |  |  |  |  |  |  |  |  |  |  |  | 0.59 ms <sub>p90 0.73 ms</sub> |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-multi-region-active-active |  |  |  |  |  |  |  |  |  | 0.43 ms <sub>p90 0.53 ms</sub> |  |  |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-nightly-batch-elt |  |  |  |  |  |  |  |  |  |  |  | 0.40 ms <sub>p90 0.44 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | example-notification-fanout |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.81 ms <sub>p90 0.91 ms</sub> |  |  |
| `inspectorPlanning-keystroke/p2` | example-rag-assistant |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0.81 ms <sub>p90 0.97 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/p2` | mesh |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.23 ms <sub>p90 1.40 ms</sub> |
| `inspectorPlanning-keystroke/p2` | pipeline |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.22 ms <sub>p90 1.27 ms</sub> |
| `inspectorPlanning-keystroke/p3` | example-branch-to-datacentre |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.04 ms <sub>p90 1.10 ms</sub> |  |  |  |  |
| `inspectorPlanning-keystroke/p3` | example-nightly-batch-elt |  |  |  |  |  |  |  |  |  |  |  | 0.50 ms <sub>p90 0.57 ms</sub> |  |  |  |  |  |  |  |
| `inspectorPlanning-keystroke/p3` | mesh |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1.42 ms <sub>p90 1.69 ms</sub> |
| `planningCompute/legacy` | examples | 3.86 ms <sub>p90 4.12 ms</sub> | 11 ms <sub>p90 11 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/legacy` | mesh | 3.43 ms <sub>p90 3.88 ms</sub> | 7.73 ms <sub>p90 9.55 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/legacy` | pipeline | 3.28 ms <sub>p90 3.46 ms</sub> | 6.93 ms <sub>p90 7.37 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p1` | examples | 3.32 ms <sub>p90 3.57 ms</sub> | 7.35 ms <sub>p90 8.23 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p1` | mesh | 3.15 ms <sub>p90 3.64 ms</sub> | 7.14 ms <sub>p90 9.17 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p1` | pipeline | 2.99 ms <sub>p90 3.83 ms</sub> | 5.94 ms <sub>p90 6.99 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p2` | examples | 3.01 ms <sub>p90 3.46 ms</sub> | 8.03 ms <sub>p90 8.51 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p2` | mesh | 3.36 ms <sub>p90 3.98 ms</sub> | 8.32 ms <sub>p90 9.61 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p2` | pipeline | 2.84 ms <sub>p90 3.01 ms</sub> | 6.32 ms <sub>p90 6.68 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p3` | examples | 3.70 ms <sub>p90 4.44 ms</sub> | 8.78 ms <sub>p90 10 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p3` | mesh | 3.57 ms <sub>p90 4.00 ms</sub> | 7.33 ms <sub>p90 8.56 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningCompute/p3` | pipeline | 2.80 ms <sub>p90 3.34 ms</sub> | 5.69 ms <sub>p90 5.93 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningSignature` | annotated | 0.22 ms <sub>p90 0.25 ms</sub> |  | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningSignature` | examples | 0.24 ms <sub>p90 0.25 ms</sub> |  | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningSignature` | k8s | 0.26 ms <sub>p90 0.32 ms</sub> |  | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningSignature` | mesh | 0.17 ms <sub>p90 0.17 ms</sub> |  | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningSignature` | pipeline | 0.22 ms <sub>p90 0.23 ms</sub> |  | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `planningSignature` | terraform | 0.21 ms <sub>p90 0.23 ms</sub> |  | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> | 0.00 ms <sub>p90 0.00 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `upgradePlanning` | annotated | 1.77 ms <sub>p90 1.92 ms</sub> |  | 5.78 ms <sub>p90 6.46 ms</sub> | 17 ms <sub>p90 17 ms</sub> | 56 ms <sub>p90 58 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `upgradePlanning` | examples | 1.13 ms <sub>p90 1.47 ms</sub> |  | 5.68 ms <sub>p90 7.99 ms</sub> | 17 ms <sub>p90 18 ms</sub> | 130 ms <sub>p90 213 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `upgradePlanning` | k8s | 1.34 ms <sub>p90 1.66 ms</sub> |  | 8.26 ms <sub>p90 8.95 ms</sub> | 18 ms <sub>p90 20 ms</sub> | 68 ms <sub>p90 90 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `upgradePlanning` | mesh | 1.02 ms <sub>p90 1.11 ms</sub> |  | 6.71 ms <sub>p90 8.29 ms</sub> | 25 ms <sub>p90 27 ms</sub> | 59 ms <sub>p90 69 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `upgradePlanning` | pipeline | 1.21 ms <sub>p90 1.56 ms</sub> |  | 8.69 ms <sub>p90 11 ms</sub> | 21 ms <sub>p90 25 ms</sub> | 76 ms <sub>p90 98 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `upgradePlanning` | terraform | 1.28 ms <sub>p90 1.50 ms</sub> |  | 5.44 ms <sub>p90 6.09 ms</sub> | 13 ms <sub>p90 16 ms</sub> | 53 ms <sub>p90 70 ms</sub> |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## profile

| Metric | Value | Note |
| --- | ---: | ---: |
| `drag-pipeline@500/busy` | 4.77 s | main-thread time not idle |
| `drag-pipeline@500/profiled` | 4.80 s | wall time profiled |
| `drag-pipeline@500/self/` | 727 ms |  |
| `drag-pipeline@500/self/(garbage collector)` | 114 ms |  |
| `drag-pipeline@500/self/(program)` | 1.71 s |  |
| `drag-pipeline@500/self/NodeWrapper` | 50 ms |  |
| `drag-pipeline@500/self/createWorkInProgress` | 47 ms |  |
| `drag-pipeline@500/self/getBoundingClientRect` | 80 ms |  |
| `drag-pipeline@500/self/linkCost` | 203 ms |  |
| `drag-pipeline@500/self/querySelector` | 36 ms |  |
| `drag-pipeline@500/self/read$1` | 219 ms |  |
| `drag-pipeline@500/self/route` | 50 ms |  |
| `drag-pipeline@500/self/search$1` | 91 ms |  |
| `drag-pipeline@500/self/segmentHitsRect` | 59 ms |  |
| `drag-pipeline@500/self/setState` | 72 ms |  |
| `drag-pipeline@500/self/shallow$1` | 53 ms |  |
| `drag-pipeline@500/self/updateProperties` | 51 ms |  |
| `live-pipeline@500/busy` | 3.87 s | main-thread time not idle |
| `live-pipeline@500/profiled` | 4.09 s | wall time profiled |
| `live-pipeline@500/self/` | 40 ms |  |
| `live-pipeline@500/self/(program)` | 2.24 s |  |
| `live-pipeline@500/self/NodeBadge` | 38 ms |  |
| `live-pipeline@500/self/apply` | 66 ms |  |
| `live-pipeline@500/self/commitMutationEffectsOnFiber` | 37 ms |  |
| `live-pipeline@500/self/getAttribute` | 32 ms |  |
| `live-pipeline@500/self/getPointAtLength` | 195 ms |  |
| `live-pipeline@500/self/getTotalLength` | 69 ms |  |
| `live-pipeline@500/self/querySelectorAll` | 82 ms |  |
| `live-pipeline@500/self/readMarch` | 405 ms |  |
| `live-pipeline@500/self/setTextContent` | 28 ms |  |
| `live-pipeline@500/self/setValueForStyles` | 25 ms |  |
| `live-pipeline@500/self/tick` | 38 ms |  |
| `live-pipeline@500/self/updateEffect` | 26 ms |  |
| `live-pipeline@500/self/updateProperties` | 40 ms |  |
| `load-pipeline@1500/busy` | 4.14 s | main-thread time not idle |
| `load-pipeline@1500/profiled` | 7.25 s | wall time profiled |
| `load-pipeline@1500/self/` | 324 ms |  |
| `load-pipeline@1500/self/(garbage collector)` | 88 ms |  |
| `load-pipeline@1500/self/(program)` | 1.06 s |  |
| `load-pipeline@1500/self/check` | 648 ms |  |
| `load-pipeline@1500/self/checkIfSnapshotChanged` | 43 ms |  |
| `load-pipeline@1500/self/getHostSibling` | 56 ms |  |
| `load-pipeline@1500/self/memoizedSelector` | 45 ms |  |
| `load-pipeline@1500/self/overlayRects` | 464 ms |  |
| `load-pipeline@1500/self/read$1` | 57 ms |  |
| `load-pipeline@1500/self/right` | 59 ms |  |
| `load-pipeline@1500/self/routeOrthogonal` | 49 ms |  |
| `load-pipeline@1500/self/search$1` | 38 ms |  |
| `load-pipeline@1500/self/setProp` | 42 ms |  |
| `load-pipeline@1500/self/setValueForAttribute` | 48 ms |  |
| `load-pipeline@1500/self/updateDimensions` | 64 ms |  |
| `select-pipeline@1500/busy` | 4.46 s | main-thread time not idle |
| `select-pipeline@1500/profiled` | 4.46 s | wall time profiled |
| `select-pipeline@1500/self/` | 1.43 s |  |
| `select-pipeline@1500/self/(garbage collector)` | 163 ms |  |
| `select-pipeline@1500/self/(program)` | 906 ms |  |
| `select-pipeline@1500/self/NodeWrapper` | 81 ms |  |
| `select-pipeline@1500/self/getBoundingClientRect` | 127 ms |  |
| `select-pipeline@1500/self/querySelector` | 88 ms |  |
| `select-pipeline@1500/self/read$1` | 198 ms |  |
| `select-pipeline@1500/self/setState` | 52 ms |  |
| `select-pipeline@1500/self/shallow$1` | 118 ms |  |
| `select-pipeline@1500/self/shallowEqual` | 56 ms |  |
| `select-pipeline@1500/self/updateEffect` | 61 ms |  |
| `select-pipeline@1500/self/updateMemo` | 60 ms |  |
| `select-pipeline@1500/self/updateProperties` | 100 ms |  |
| `select-pipeline@1500/self/updateSimpleMemoComponent` | 47 ms |  |
| `select-pipeline@1500/self/useNodeObserver` | 47 ms |  |
| `typeName-mesh@500/busy` | 2.83 s | main-thread time not idle |
| `typeName-mesh@500/profiled` | 3.43 s | wall time profiled |
| `typeName-mesh@500/self/` | 544 ms |  |
| `typeName-mesh@500/self/(garbage collector)` | 76 ms |  |
| `typeName-mesh@500/self/(program)` | 285 ms |  |
| `typeName-mesh@500/self/clip` | 51 ms |  |
| `typeName-mesh@500/self/getBoundingClientRect` | 128 ms |  |
| `typeName-mesh@500/self/inflate` | 73 ms |  |
| `typeName-mesh@500/self/linkCost` | 209 ms |  |
| `typeName-mesh@500/self/moveSegment` | 48 ms |  |
| `typeName-mesh@500/self/query` | 69 ms |  |
| `typeName-mesh@500/self/querySelectorAll` | 37 ms |  |
| `typeName-mesh@500/self/read$1` | 127 ms |  |
| `typeName-mesh@500/self/search$1` | 83 ms |  |
| `typeName-mesh@500/self/segmentHitsRect` | 141 ms |  |
| `typeName-mesh@500/self/shallow$1` | 38 ms |  |
| `typeName-mesh@500/self/updateProperties` | 40 ms |  |

## renders

| Metric | Workload | 100 | 500 | 1500 |
| --- | ---: | ---: | ---: | ---: |
| `drag/A11yDescriptions` | mesh | 1.60 | 1.40 |  |
| `drag/A11yDescriptions` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/AiMount` | mesh | 1.40 | 1.10 |  |
| `drag/AiMount` | pipeline | 1.10 | 1.30 | 1.50 |
| `drag/AriaLiveMessage` | mesh | 1.60 | 1.40 |  |
| `drag/AriaLiveMessage` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Attribution` | mesh | 1.60 | 1.40 |  |
| `drag/Attribution` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/CanvasInner` | mesh | 1.60 | 1.40 |  |
| `drag/CanvasInner` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/CardNode` | mesh | 1.20 | 1.10 |  |
| `drag/CardNode` | pipeline | 1 | 1.10 | 1.10 |
| `drag/ConnectionLineWrapper` | mesh | 1.60 | 1.40 |  |
| `drag/ConnectionLineWrapper` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/ControlButton` | mesh | 9.60 | 8.40 |  |
| `drag/ControlButton` | pipeline | 8.40 | 11.40 | 10.20 |
| `drag/Controls` | mesh | 1.60 | 1.40 |  |
| `drag/Controls` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/CopyId` | mesh | 1.60 | 1.40 |  |
| `drag/CopyId` | pipeline | 1.40 | 1.70 | 1.70 |
| `drag/DiagramCardMeta` | mesh | 1.80 | 1.80 |  |
| `drag/DiagramCardMeta` | pipeline | 1.50 | 2.10 | 1.70 |
| `drag/DiagramNodeImpl` | mesh | 1.20 | 1.10 |  |
| `drag/DiagramNodeImpl` | pipeline | 1 | 1.10 | 1.10 |
| `drag/Disclosure` | mesh | 3.20 | 2.80 |  |
| `drag/Disclosure` | pipeline | 2.80 | 3.40 | 3.40 |
| `drag/DotGrid` | mesh | 1.60 | 1.40 |  |
| `drag/DotGrid` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/EdgeLabelRenderer` | mesh | 15 | 20.20 |  |
| `drag/EdgeLabelRenderer` | pipeline | 1.60 | 1.80 | 4.20 |
| `drag/EdgeMarkers` | mesh | 1.60 | 1.40 |  |
| `drag/EdgeMarkers` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/EdgeWrapper` | mesh | 3 | 4.50 |  |
| `drag/EdgeWrapper` | pipeline | 2.40 | 2.40 | 1.60 |
| `drag/Field` | mesh | 6.40 | 5.60 |  |
| `drag/Field` | pipeline | 5.60 | 7.60 | 6.80 |
| `drag/FindingRow` | mesh | 1.70 | 1.60 |  |
| `drag/FirstRunHint` | mesh | 1.60 | 1.40 |  |
| `drag/FirstRunHint` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/FlowEdgeImpl` | mesh | 20.30 | 30.60 |  |
| `drag/FlowEdgeImpl` | pipeline | 2.40 | 2.60 | 5.30 |
| `drag/FlowRenderer` | mesh | 1.60 | 1.40 |  |
| `drag/FlowRenderer` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Glyph` | mesh |  | 1 |  |
| `drag/Glyph` | pipeline |  | 1 | 2 |
| `drag/GraphView` | mesh | 1.60 | 1.40 |  |
| `drag/GraphView` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Icon` | mesh | 24.60 | 22.30 |  |
| `drag/Icon` | pipeline | 16.90 | 22.60 | 21.80 |
| `drag/Inspector` | mesh | 1.60 | 1.40 |  |
| `drag/Inspector` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/InspectorFindings` | mesh | 1.70 | 1.60 |  |
| `drag/LandingOutline` | mesh | 1.60 | 1.40 |  |
| `drag/LandingOutline` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Lazy` | mesh | 3.30 | 3 |  |
| `drag/Lazy` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/LiveView` | mesh | 1.60 | 1.40 |  |
| `drag/LiveView` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Menu` | pipeline |  |  | 1.20 |
| `drag/MiniMap` | mesh | 1.60 | 1.40 |  |
| `drag/MiniMap` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/MiniMapNodeComponent` | mesh | 1.10 |  |  |
| `drag/MiniMapNodeComponent` | pipeline |  | 1 | 1 |
| `drag/MiniMapNodes` | mesh | 1.60 | 1.40 |  |
| `drag/MiniMapNodes` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/MinusIcon` | mesh | 1.60 | 1.40 |  |
| `drag/MinusIcon` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/NodeComponentWrapperInner` | mesh | 167.70 | 728.90 |  |
| `drag/NodeComponentWrapperInner` | pipeline | 143.80 | 972.20 | 2605.50 |
| `drag/NodePanel` | mesh | 1.60 | 1.40 |  |
| `drag/NodePanel` | pipeline | 1.40 | 1.70 | 1.70 |
| `drag/NodePlanning` | mesh | 1.60 | 1.40 |  |
| `drag/NodePlanning` | pipeline | 1.40 | 1.70 | 1.70 |
| `drag/NodeRenderer` | mesh | 1.60 | 1.40 |  |
| `drag/NodeRenderer` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/NodeTooltip` | pipeline |  | 1.20 | 1 |
| `drag/NodeWrapper` | mesh | 167.70 | 729.10 |  |
| `drag/NodeWrapper` | pipeline | 143.90 | 972.20 | 2605.50 |
| `drag/Pane` | mesh | 1.60 | 1.40 |  |
| `drag/Pane` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Panel` | mesh | 4.80 | 4.20 |  |
| `drag/Panel` | pipeline | 4.20 | 5.70 | 5.10 |
| `drag/PlusIcon` | mesh | 1.60 | 1.40 |  |
| `drag/PlusIcon` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/ReactFlow` | mesh | 1.60 | 1.40 |  |
| `drag/ReactFlow` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Section` | mesh | 1.60 | 1.40 |  |
| `drag/Section` | pipeline | 1.40 | 2.10 | 1.70 |
| `drag/SelectionFindings` | mesh | 1.70 | 1.70 |  |
| `drag/SelectionFindings` | pipeline | 1.50 | 1.90 | 1.70 |
| `drag/SelectionListener` | mesh | 1.60 | 1.40 |  |
| `drag/SelectionListener` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/SelectionListenerInner` | mesh | 1.70 | 1.50 |  |
| `drag/SelectionListenerInner` | pipeline | 1.50 | 2 | 1.80 |
| `drag/StencilIcon` | mesh | 2.80 | 2.50 |  |
| `drag/StencilIcon` | pipeline | 2.40 | 2.80 | 2.80 |
| `drag/StoreUpdater` | mesh | 1.60 | 1.40 |  |
| `drag/StoreUpdater` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/UserSelection` | mesh | 1.60 | 1.40 |  |
| `drag/UserSelection` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Viewport` | mesh | 1.60 | 1.40 |  |
| `drag/Viewport` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/Wrapper` | mesh | 1.60 | 1.40 |  |
| `drag/Wrapper` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/ZoomPane` | mesh | 1.60 | 1.40 |  |
| `drag/ZoomPane` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/ZoomVar` | mesh | 1.60 | 1.40 |  |
| `drag/ZoomVar` | pipeline | 1.40 | 1.90 | 1.70 |
| `drag/commits` | mesh | 3.20 | 3 |  |
| `drag/commits` | pipeline | 2.80 | 3.50 | 3 |
| `drag/total` | mesh | 495.80 | 1624.90 |  |
| `drag/total` | pipeline | 391.80 | 2084.20 | 5348.50 |
| `live/ControlBar` | pipeline | 7.30 | 5.70 | 3 |
| `live/IdleChip` | pipeline | 491.30 | 1,300 | 456 |
| `live/LiveIcon` | pipeline | 396 | 923.70 | 296.30 |
| `live/LiveSession` | pipeline | 7.30 | 5.70 | 3 |
| `live/MoreMenu` | pipeline | 7.30 | 5.70 | 3 |
| `live/NodeBadge` | pipeline | 733.30 | 2833.30 | 4,500 |
| `live/NodeBadges` | pipeline | 7.30 | 5.70 | 3 |
| `live/NoteCallout` | pipeline | 7.30 | 5.70 | 3 |
| `live/Recorder` | pipeline | 7.30 | 5.70 | 3 |
| `live/SlowCaption` | pipeline | 7.30 | 5.70 | 3 |
| `live/ViewportPortal` | pipeline | 7.30 | 5.70 | 3 |
| `live/commits` | pipeline | 7.30 | 5.70 | 3 |
| `live/rendersPerCommit` | pipeline | 229 | 900.40 | 1758.80 |
| `live/total` | pipeline | 1679.30 | 5102.30 | 5276.30 |
| `pan/ControlButton` | mesh |  | 2.40 |  |
| `pan/ControlButton` | pipeline | 2.40 | 3.60 | 2.40 |
| `pan/DiagramNodeImpl` | mesh | 0 | 0.40 |  |
| `pan/DiagramNodeImpl` | pipeline |  |  | 0.30 |
| `pan/Icon` | mesh | 1.10 | 4.80 |  |
| `pan/Icon` | pipeline | 4.10 | 6 | 4.10 |
| `pan/NodeComponentWrapperInner` | mesh | 10.40 | 208.30 |  |
| `pan/NodeComponentWrapperInner` | pipeline | 41 | 307.20 | 613 |
| `pan/NodeWrapper` | mesh | 10.40 | 208.30 |  |
| `pan/NodeWrapper` | pipeline |  |  | 613.20 |
| `pan/Panel` | mesh |  | 1.30 |  |
| `pan/Panel` | pipeline | 1.30 | 1.90 | 1.30 |
| `pan/SelectionListenerInner` | pipeline |  | 1 |  |
| `pan/UserSelection` | mesh | 1.20 | 1.30 |  |
| `pan/UserSelection` | pipeline | 1.30 | 1.40 | 1.40 |
| `pan/commits` | mesh | 1.40 | 1.90 |  |
| `pan/commits` | pipeline | 2.20 | 2.50 | 2.20 |
| `pan/total` | mesh | 27.50 | 441.80 |  |
| `pan/total` | pipeline | 108.10 | 653.90 | 1252.30 |
| `select/A11yDescriptions` | mesh | 4 | 4 |  |
| `select/A11yDescriptions` | pipeline | 4 | 4 | 4 |
| `select/AiMount` | mesh | 1 | 1 |  |
| `select/AiMount` | pipeline | 1 | 1 | 1 |
| `select/AriaLiveMessage` | mesh | 4 | 4 |  |
| `select/AriaLiveMessage` | pipeline | 4 | 4 | 4 |
| `select/Attribution` | mesh | 4 | 4 |  |
| `select/Attribution` | pipeline | 4 | 4 | 4 |
| `select/CanvasInner` | mesh | 4 | 4 |  |
| `select/CanvasInner` | pipeline | 4 | 4 | 4 |
| `select/CardNode` | mesh | 3 | 3 |  |
| `select/CardNode` | pipeline | 3 | 3 | 3 |
| `select/ConnectionLineWrapper` | mesh | 4 | 4 |  |
| `select/ConnectionLineWrapper` | pipeline | 4 | 4 | 4 |
| `select/ControlButton` | mesh | 24 | 24 |  |
| `select/ControlButton` | pipeline | 24 | 24 | 24 |
| `select/Controls` | mesh | 4 | 4 |  |
| `select/Controls` | pipeline | 4 | 4 | 4 |
| `select/CopyId` | mesh | 4 | 4 |  |
| `select/CopyId` | pipeline | 4 | 4 | 4 |
| `select/DiagramCardMeta` | mesh | 4.50 | 4.33 |  |
| `select/DiagramCardMeta` | pipeline | 4.33 | 4.33 | 4 |
| `select/DiagramNodeImpl` | mesh | 3 | 3 |  |
| `select/DiagramNodeImpl` | pipeline |  |  | 3 |
| `select/Disclosure` | mesh | 8 | 8 |  |
| `select/Disclosure` | pipeline | 8 | 8 | 8 |
| `select/DotGrid` | mesh | 4 | 4 |  |
| `select/DotGrid` | pipeline | 4 | 4 | 4 |
| `select/EdgeLabelRenderer` | mesh | 1.17 | 1 |  |
| `select/EdgeMarkers` | mesh | 4 | 4 |  |
| `select/EdgeMarkers` | pipeline | 4 | 4 | 4 |
| `select/EdgeWrapper` | mesh | 1.17 | 1.50 |  |
| `select/Field` | mesh | 16 | 16 |  |
| `select/Field` | pipeline | 16 | 16 | 16 |
| `select/FindingRow` | pipeline | 1.50 |  |  |
| `select/FirstRunHint` | mesh | 4 | 4 |  |
| `select/FirstRunHint` | pipeline | 4 | 4 | 4 |
| `select/FlowEdgeImpl` | mesh | 1.17 | 1.50 |  |
| `select/FlowRenderer` | mesh | 4 | 4 |  |
| `select/FlowRenderer` | pipeline | 4 | 4 | 4 |
| `select/GraphView` | mesh | 4 | 4 |  |
| `select/GraphView` | pipeline | 4 | 4 | 4 |
| `select/GrowChip` | mesh | 1 | 2 |  |
| `select/GrowChip` | pipeline | 1.67 | 1.67 | 2 |
| `select/HandleComponent` | mesh | 1 | 2 |  |
| `select/HandleComponent` | pipeline | 1.67 | 1.67 | 2 |
| `select/Icon` | mesh | 50.83 | 50.67 |  |
| `select/Icon` | pipeline | 46.50 | 45.33 | 45 |
| `select/Inspector` | mesh | 4 | 4 |  |
| `select/Inspector` | pipeline | 4 | 4 | 4 |
| `select/InspectorFindings` | pipeline | 1.50 |  |  |
| `select/LandingOutline` | mesh | 4 | 4 |  |
| `select/LandingOutline` | pipeline | 4 | 4 | 4 |
| `select/Lazy` | mesh | 4.67 | 5.50 |  |
| `select/Lazy` | pipeline | 5.50 | 5 | 4 |
| `select/LiveView` | mesh | 4 | 4 |  |
| `select/LiveView` | pipeline | 4 | 4 | 4 |
| `select/MiniMap` | mesh | 4 | 4 |  |
| `select/MiniMap` | pipeline | 4 | 4 | 4 |
| `select/MiniMapNodeComponent` | mesh | 2 | 2 |  |
| `select/MiniMapNodeComponent` | pipeline | 2 | 2 | 2 |
| `select/MiniMapNodes` | mesh | 4 | 4 |  |
| `select/MiniMapNodes` | pipeline | 4 | 4 | 4 |
| `select/MinusIcon` | mesh | 4 | 4 |  |
| `select/MinusIcon` | pipeline | 4 | 4 | 4 |
| `select/NodeComponentWrapperInner` | mesh | 420 | 2,084 |  |
| `select/NodeComponentWrapperInner` | pipeline | 412 | 2,048 | 6,132 |
| `select/NodePanel` | mesh | 4 | 4 |  |
| `select/NodePanel` | pipeline | 4 | 4 | 4 |
| `select/NodePlanning` | mesh | 4 | 4 |  |
| `select/NodePlanning` | pipeline | 4 | 4 | 4 |
| `select/NodeRenderer` | mesh | 4 | 4 |  |
| `select/NodeRenderer` | pipeline | 4 | 4 | 4 |
| `select/NodeTooltip` | mesh | 3 | 3 |  |
| `select/NodeTooltip` | pipeline | 3 | 3 | 3 |
| `select/NodeWrapper` | mesh | 421 | 2,086 |  |
| `select/NodeWrapper` | pipeline |  |  | 6,134 |
| `select/PaletteFoot` | mesh | 1 | 1 |  |
| `select/PaletteFoot` | pipeline | 1 | 1 | 1 |
| `select/Pane` | mesh | 4 | 4 |  |
| `select/Pane` | pipeline | 4 | 4 | 4 |
| `select/Panel` | mesh | 12 | 12 |  |
| `select/Panel` | pipeline | 12 | 12 | 12 |
| `select/PlusIcon` | mesh | 4 | 4 |  |
| `select/PlusIcon` | pipeline | 4 | 4 | 4 |
| `select/ReactFlow` | mesh | 4 | 4 |  |
| `select/ReactFlow` | pipeline | 4 | 4 | 4 |
| `select/Section` | mesh | 4 | 4 |  |
| `select/Section` | pipeline | 4 | 4 | 4 |
| `select/SelectionFindings` | mesh | 4.50 | 4.33 |  |
| `select/SelectionFindings` | pipeline | 4.33 | 4.33 | 4 |
| `select/SelectionListener` | mesh | 4 | 4 |  |
| `select/SelectionListener` | pipeline | 4 | 4 | 4 |
| `select/SelectionListenerInner` | mesh | 5 | 5 |  |
| `select/SelectionListenerInner` | pipeline | 5 | 5 | 5 |
| `select/StencilIcon` | mesh | 7 | 7 |  |
| `select/StencilIcon` | pipeline | 7 | 7 | 7 |
| `select/StoreUpdater` | mesh | 4 | 4 |  |
| `select/StoreUpdater` | pipeline | 4 | 4 | 4 |
| `select/UserSelection` | mesh | 4 | 4 |  |
| `select/UserSelection` | pipeline | 4 | 4 | 4 |
| `select/Viewport` | mesh | 4 | 4 |  |
| `select/Viewport` | pipeline | 4 | 4 | 4 |
| `select/Wrapper` | mesh | 4 | 4 |  |
| `select/Wrapper` | pipeline | 4 | 4 | 4 |
| `select/ZoomPane` | mesh | 4 | 4 |  |
| `select/ZoomPane` | pipeline | 4 | 4 | 4 |
| `select/ZoomVar` | mesh | 4 | 4 |  |
| `select/ZoomVar` | pipeline | 4 | 4 | 4 |
| `select/commits` | mesh | 7.33 | 10.17 |  |
| `select/commits` | pipeline |  |  | 10 |
| `select/total` | mesh | 1125.33 | 4457.17 |  |
| `select/total` | pipeline | 1107.50 | 4374.67 | 12542.17 |
| `type-name/A11yDescriptions` | mesh | 1.58 | 1.75 |  |
| `type-name/A11yDescriptions` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/AiMount` | mesh | 1.50 | 1.75 |  |
| `type-name/AiMount` | pipeline | 1.08 | 1.17 | 1.67 |
| `type-name/AriaLiveMessage` | mesh | 1.58 | 1.75 |  |
| `type-name/AriaLiveMessage` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Attribution` | mesh | 1.58 | 1.75 |  |
| `type-name/Attribution` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/CanvasInner` | mesh | 1.58 | 1.75 |  |
| `type-name/CanvasInner` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/CardNode` | mesh | 1.33 | 1.33 |  |
| `type-name/CardNode` | pipeline | 1 | 1.08 | 1.08 |
| `type-name/ConnectionLineWrapper` | mesh | 1.58 | 1.75 |  |
| `type-name/ConnectionLineWrapper` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/ControlButton` | mesh | 9.50 | 10.50 |  |
| `type-name/ControlButton` | pipeline | 7 | 7.50 | 9 |
| `type-name/Controls` | mesh | 1.58 | 1.75 |  |
| `type-name/Controls` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/CopyId` | mesh | 1.58 | 1.75 |  |
| `type-name/CopyId` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/DiagramCardMeta` | mesh | 1.67 | 1.83 |  |
| `type-name/DiagramCardMeta` | pipeline | 1.25 | 1.33 | 1.50 |
| `type-name/DiagramNodeImpl` | mesh | 1.33 | 1.33 |  |
| `type-name/DiagramNodeImpl` | pipeline |  |  | 1.08 |
| `type-name/Disclosure` | mesh | 3.17 | 3.50 |  |
| `type-name/Disclosure` | pipeline | 2.33 | 2.50 | 3 |
| `type-name/DotGrid` | mesh | 1.58 | 1.75 |  |
| `type-name/DotGrid` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/EdgeLabelRenderer` | mesh | 3 | 3.08 |  |
| `type-name/EdgeMarkers` | mesh | 1.58 | 1.75 |  |
| `type-name/EdgeMarkers` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/EdgeWrapper` | mesh | 4 | 6.67 |  |
| `type-name/EdgeWrapper` | pipeline | 3 | 2.17 | 2.17 |
| `type-name/Field` | mesh | 6.33 | 7 |  |
| `type-name/Field` | pipeline | 4.67 | 5 | 6 |
| `type-name/FindingRow` | mesh | 1.67 | 1.83 |  |
| `type-name/FirstRunHint` | mesh | 1.58 | 1.75 |  |
| `type-name/FirstRunHint` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/FlowEdgeImpl` | mesh | 5.58 | 6.08 |  |
| `type-name/FlowRenderer` | mesh | 1.58 | 1.75 |  |
| `type-name/FlowRenderer` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Glyph` | mesh |  | 2.08 |  |
| `type-name/Glyph` | pipeline |  |  | 2.92 |
| `type-name/GraphView` | mesh | 1.58 | 1.75 |  |
| `type-name/GraphView` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/GrowChip` | mesh | 1.67 | 1.67 |  |
| `type-name/GrowChip` | pipeline | 1 | 1.17 | 1.17 |
| `type-name/HandleComponent` | mesh | 1.67 | 1.67 |  |
| `type-name/HandleComponent` | pipeline | 1 | 1.17 | 1.17 |
| `type-name/Icon` | mesh | 24.58 | 28.17 |  |
| `type-name/Icon` | pipeline | 14.25 | 15.25 | 20.50 |
| `type-name/Inspector` | mesh | 1.58 | 1.75 |  |
| `type-name/Inspector` | pipeline |  |  | 1.50 |
| `type-name/InspectorFindings` | mesh | 1.67 | 1.83 |  |
| `type-name/LandingOutline` | mesh | 1.58 | 1.75 |  |
| `type-name/LandingOutline` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Lazy` | mesh | 3.25 | 3.58 |  |
| `type-name/Lazy` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/LiveView` | mesh | 1.58 | 1.75 |  |
| `type-name/LiveView` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/MarkerDefinitions` | mesh | 1.33 | 1.33 |  |
| `type-name/MarkerDefinitions` | pipeline | 1 | 1.08 | 1.08 |
| `type-name/Menu` | mesh |  | 1.25 |  |
| `type-name/Menu` | pipeline |  |  | 1.75 |
| `type-name/MiniMap` | mesh | 1.58 | 1.75 |  |
| `type-name/MiniMap` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/MiniMapNodes` | mesh | 1.58 | 1.75 |  |
| `type-name/MiniMapNodes` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/MinusIcon` | mesh | 1.58 | 1.75 |  |
| `type-name/MinusIcon` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/NodeComponentWrapperInner` | mesh | 166 | 911.33 |  |
| `type-name/NodeComponentWrapperInner` | pipeline | 120 | 639.83 | 2299.08 |
| `type-name/NodePanel` | mesh | 1.58 | 1.75 |  |
| `type-name/NodePanel` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/NodePlanning` | mesh | 1.58 | 1.75 |  |
| `type-name/NodePlanning` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/NodeRenderer` | mesh | 1.58 | 1.75 |  |
| `type-name/NodeRenderer` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/NodeWrapper` | mesh | 166 | 911.33 |  |
| `type-name/NodeWrapper` | pipeline |  |  | 2299.08 |
| `type-name/Palette` | mesh | 0 | 0 |  |
| `type-name/Palette` | pipeline |  |  | 0 |
| `type-name/PaletteFoot` | mesh | 1 | 1 |  |
| `type-name/PaletteFoot` | pipeline | 1 | 1 | 1 |
| `type-name/PaletteItem` | mesh | 0 | 0 |  |
| `type-name/PaletteItem` | pipeline |  |  | 0 |
| `type-name/Pane` | mesh | 1.58 | 1.75 |  |
| `type-name/Pane` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Panel` | mesh | 4.75 | 5.25 |  |
| `type-name/Panel` | pipeline | 3.50 | 3.75 | 4.50 |
| `type-name/PlusIcon` | mesh | 1.58 | 1.75 |  |
| `type-name/PlusIcon` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/ReactFlow` | mesh | 1.58 | 1.75 |  |
| `type-name/ReactFlow` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Section` | mesh | 1.58 | 1.75 |  |
| `type-name/Section` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/SelectionFindings` | mesh | 1.67 | 1.83 |  |
| `type-name/SelectionFindings` | pipeline | 1.25 | 1.33 | 1.50 |
| `type-name/SelectionListener` | mesh | 1.58 | 1.75 |  |
| `type-name/SelectionListener` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/SelectionListenerInner` | mesh | 1.58 | 1.75 |  |
| `type-name/SelectionListenerInner` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/StencilIcon` | mesh | 2.92 | 3.08 |  |
| `type-name/StencilIcon` | pipeline | 2.17 | 2.33 | 2.58 |
| `type-name/StoreUpdater` | mesh | 1.58 | 1.75 |  |
| `type-name/StoreUpdater` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/UserSelection` | mesh | 1.58 | 1.75 |  |
| `type-name/UserSelection` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Viewport` | mesh | 1.58 | 1.75 |  |
| `type-name/Viewport` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/Wrapper` | mesh | 1.58 | 1.75 |  |
| `type-name/Wrapper` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/ZoomPane` | mesh | 1.58 | 1.75 |  |
| `type-name/ZoomPane` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/ZoomVar` | mesh | 1.58 | 1.75 |  |
| `type-name/ZoomVar` | pipeline | 1.17 | 1.25 | 1.50 |
| `type-name/commits` | mesh | 4.42 | 4.58 |  |
| `type-name/commits` | pipeline |  |  | 3.75 |
| `type-name/total` | mesh | 471.83 | 1984.25 |  |
| `type-name/total` | pipeline |  |  | 4721.58 |

## sim

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `engineFrame/x1` | examples | 0.04 ms <sub>p90 0.05 ms</sub> | 0.23 ms <sub>p90 0.26 ms</sub> | 0.74 ms <sub>p90 0.79 ms</sub> | 4.01 ms <sub>p90 4.37 ms</sub> |
| `engineFrame/x1` | mesh | 0.07 ms <sub>p90 0.07 ms</sub> | 0.25 ms <sub>p90 0.27 ms</sub> | 0.73 ms <sub>p90 0.82 ms</sub> | 3.19 ms <sub>p90 4.01 ms</sub> |
| `engineFrame/x1` | pipeline | 0.05 ms <sub>p90 0.05 ms</sub> | 0.24 ms <sub>p90 0.26 ms</sub> | 0.69 ms <sub>p90 0.84 ms</sub> | 3.22 ms <sub>p90 3.96 ms</sub> |
| `engineLoad` | examples | 0.54 ms <sub>p90 0.64 ms</sub> | 2.81 ms <sub>p90 3.24 ms</sub> | 9.16 ms <sub>p90 9.79 ms</sub> | 38 ms <sub>p90 40 ms</sub> |
| `engineLoad` | mesh | 0.50 ms <sub>p90 0.61 ms</sub> | 2.47 ms <sub>p90 2.95 ms</sub> | 7.71 ms <sub>p90 8.82 ms</sub> | 27 ms <sub>p90 33 ms</sub> |
| `engineLoad` | pipeline | 0.58 ms <sub>p90 0.70 ms</sub> | 2.81 ms <sub>p90 3.20 ms</sub> | 8.55 ms <sub>p90 9.98 ms</sub> | 35 ms <sub>p90 43 ms</sub> |
| `engineSnapshot/x1` | examples | 0.05 ms <sub>p90 0.06 ms</sub> | 0.25 ms <sub>p90 0.29 ms</sub> | 0.82 ms <sub>p90 0.90 ms</sub> | 5.56 ms <sub>p90 5.83 ms</sub> |
| `engineSnapshot/x1` | mesh | 0.08 ms <sub>p90 0.08 ms</sub> | 0.29 ms <sub>p90 0.30 ms</sub> | 0.94 ms <sub>p90 1.03 ms</sub> | 4.50 ms <sub>p90 5.08 ms</sub> |
| `engineSnapshot/x1` | pipeline | 0.06 ms <sub>p90 0.06 ms</sub> | 0.25 ms <sub>p90 0.28 ms</sub> | 0.83 ms <sub>p90 0.88 ms</sub> | 3.69 ms <sub>p90 4.33 ms</sub> |
| `engineStep/x1` | examples | 0.04 ms <sub>p90 0.05 ms</sub> | 0.13 ms <sub>p90 0.19 ms</sub> | 0.37 ms <sub>p90 0.53 ms</sub> | 1.24 ms <sub>p90 2.14 ms</sub> |
| `engineStep/x1` | mesh | 0.12 ms <sub>p90 0.15 ms</sub> | 0.22 ms <sub>p90 0.32 ms</sub> | 0.54 ms <sub>p90 0.74 ms</sub> | 1.36 ms <sub>p90 2.30 ms</sub> |
| `engineStep/x1` | pipeline | 0.04 ms <sub>p90 0.05 ms</sub> | 0.13 ms <sub>p90 0.17 ms</sub> | 0.36 ms <sub>p90 0.44 ms</sub> | 1.15 ms <sub>p90 1.69 ms</sub> |
| `liveFrame/x1` | examples | 0.15 ms <sub>p90 0.23 ms</sub> | 0.54 ms <sub>p90 0.65 ms</sub> | 1.76 ms <sub>p90 1.91 ms</sub> | 6.09 ms <sub>p90 7.60 ms</sub> |
| `liveFrame/x1` | mesh | 0.27 ms <sub>p90 0.63 ms</sub> | 0.66 ms <sub>p90 0.83 ms</sub> | 2.07 ms <sub>p90 2.41 ms</sub> | 8.23 ms <sub>p90 8.62 ms</sub> |
| `liveFrame/x1` | pipeline | 0.18 ms <sub>p90 0.27 ms</sub> | 0.57 ms <sub>p90 0.74 ms</sub> | 1.78 ms <sub>p90 2.09 ms</sub> | 6.88 ms <sub>p90 7.43 ms</sub> |
| `liveFrame/x10` | examples | 0.38 ms <sub>p90 0.51 ms</sub> | 0.78 ms <sub>p90 0.99 ms</sub> | 1.82 ms <sub>p90 2.23 ms</sub> | 5.52 ms <sub>p90 6.27 ms</sub> |
| `liveFrame/x10` | mesh | 0.74 ms <sub>p90 1.01 ms</sub> | 1.22 ms <sub>p90 1.59 ms</sub> | 2.90 ms <sub>p90 3.20 ms</sub> | 7.39 ms <sub>p90 7.92 ms</sub> |
| `liveFrame/x10` | pipeline | 0.39 ms <sub>p90 0.54 ms</sub> | 0.85 ms <sub>p90 1.20 ms</sub> | 2.46 ms <sub>p90 2.91 ms</sub> | 6.14 ms <sub>p90 6.91 ms</sub> |
| `liveFrame/x100` | examples | 1.51 ms <sub>p90 1.72 ms</sub> | 1.55 ms <sub>p90 1.79 ms</sub> | 2.59 ms <sub>p90 3.23 ms</sub> | 8.12 ms <sub>p90 9.33 ms</sub> |
| `liveFrame/x100` | mesh | 2.12 ms <sub>p90 2.27 ms</sub> | 2.34 ms <sub>p90 2.76 ms</sub> | 4.82 ms <sub>p90 5.01 ms</sub> | 8.30 ms <sub>p90 9.48 ms</sub> |
| `liveFrame/x100` | pipeline | 0.89 ms <sub>p90 1.24 ms</sub> | 1.12 ms <sub>p90 1.32 ms</sub> | 3.88 ms <sub>p90 4.63 ms</sub> | 8.12 ms <sub>p90 8.56 ms</sub> |
| `liveInSystem/x1` | examples | 102 | 408 | 280 | 440 |
| `liveInSystem/x1` | mesh | 4,267 | 3,563 | 4,476 | 4,224 |
| `liveInSystem/x1` | pipeline | 199 | 108 | 173 | 68 |
| `liveInSystem/x10` | examples | 5,552 | 7,249 | 5,045 | 8,025 |
| `liveInSystem/x10` | mesh | 37,682 | 27,294 | 35,212 | 28,474 |
| `liveInSystem/x10` | pipeline | 7,411 | 3,616 | 6,316 | 4,075 |
| `liveInSystem/x100` | examples | 76,135 | 127,093 | 56,412 | 88,891 |
| `liveInSystem/x100` | mesh | 167,516 | 112,944 | 162,614 | 126,436 |
| `liveInSystem/x100` | pipeline | 115,444 | 59,216 | 98,102 | 65,177 |
| `liveParticles/x1` | examples | 167 | 61 | 30 | 66 |
| `liveParticles/x1` | mesh | 1,046 | 929 | 1,322 | 1,083 |
| `liveParticles/x1` | pipeline | 197 | 117 | 186 | 85 |
| `liveParticles/x10` | examples | 1,453 | 560 | 377 | 678 |
| `liveParticles/x10` | mesh | 1,500 | 1,500 | 1,500 | 1,500 |
| `liveParticles/x10` | pipeline | 1,480 | 850 | 1,314 | 992 |
| `liveParticles/x100` | examples | 1,500 | 1,500 | 1,500 | 1,500 |
| `liveParticles/x100` | mesh | 1,500 | 1,500 | 1,500 | 1,500 |
| `liveParticles/x100` | pipeline | 1,500 | 1,500 | 1,500 | 1,500 |
| `liveTrafficLimited/x1` | examples | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x1` | mesh | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x1` | pipeline | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x10` | examples | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x10` | mesh | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x10` | pipeline | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x100` | examples | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x100` | mesh | 0 | 0 | 0 | 0 |
| `liveTrafficLimited/x100` | pipeline | 0 | 0 | 0 | 0 |
| `savedSimulation-simulatedMs/incident` | pipeline | 14.38 s | 14.79 s | 14.93 s | 14.33 s |
| `savedSimulation-simulatedMs/steady` | pipeline | 14.35 s | 14.33 s | 12.93 s | 19.18 s |
| `savedSimulation/incident` | pipeline | 28 ms <sub>p90 51 ms</sub> | 116 ms <sub>p90 144 ms</sub> | 341 ms <sub>p90 378 ms</sub> | 1.17 s <sub>p90 1.18 s</sub> |
| `savedSimulation/steady` | pipeline | 53 ms <sub>p90 57 ms</sub> | 146 ms <sub>p90 158 ms</sub> | 351 ms <sub>p90 364 ms</sub> | 1.55 s <sub>p90 1.56 s</sub> |

## workloads

| Metric | Workload | 100 | 500 | 1500 | 5000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `edges` | annotated | 108 | 531 | 1,610 | 5,386 |
| `edges` | examples | 100 | 510 | 1,537 | 5,130 |
| `edges` | k8s | 144 | 749 | 2,269 | 7,457 |
| `edges` | mesh | 166 | 851 | 2,478 | 8,281 |
| `edges` | pipeline | 99 | 485 | 1,457 | 4,882 |
| `edges` | terraform | 101 | 500 | 1,500 | 4,995 |
| `nodes` | annotated | 100 | 500 | 1,500 | 5,000 |
| `nodes` | examples | 100 | 500 | 1,500 | 5,000 |
| `nodes` | k8s | 99 | 501 | 1,501 | 4,997 |
| `nodes` | mesh | 100 | 500 | 1,500 | 5,000 |
| `nodes` | pipeline | 100 | 500 | 1,500 | 5,000 |
| `nodes` | terraform | 102 | 501 | 1,501 | 4,996 |

Times are medians (p90 beside them when there were more than two samples). Report-only: compare them as a trend
(`pnpm bench:compare`), normalised by the calibration. Gates are counts, ratios and sizes.
