## Live session and canvas trim — 2026-10-27

Measured against origin/master at 96fdfef62, using Node 24.22.0 and the production bundle gate. All budgets and the skill ZIP cap are unchanged.

| Download          | Before gzip B | After gzip B | Saved B | Headroom B |
| ----------------- | ------------: | -----------: | ------: | ---------: |
| Main entry        |        111332 |       109576 |    1756 |      13924 |
| Startup           |        163138 |       159647 |    3491 |      17353 |
| Canvas first view |        378295 |       373879 |    4416 |       9121 |
| Live additional   |        134981 |       131549 |    3432 |       3451 |
| All JavaScript    |       4283321 |      4271283 |   12038 |          — |

## Savings and scope

- Startup falls from 19 chunks to six. The already preloaded model grammar shares native; React, translation lookup and small shell helpers share shell-runtime. This removes repeated imports/exports and gzip dictionaries, without downloading additional modules for startup.
- Playback grammar, defaults and topology share playback-model. The simulation engine remains separate and its source is untouched. Live's small shared utilities share live-helpers. Both groups remove compression overhead across existing static dependencies.
- Canvas first view saves 4,416 B overall; its JavaScript still consists of startup plus exactly CanvasView and canvas-shared.
- Live saves 3,432 B overall. The eager spotlight and slow-motion camera use a small tracePath helper instead of constructing the complete journey just to obtain nodes and edges. Journey construction remains in the existing trace/script chunks. Duration formatting has its own small module. The journey builder uses the same path helper to preserve first-use order and path semantics.
- No new lazy surface, focus handoff, loading state, Retry mechanism or export policy was introduced. Existing held-chunk contracts continue to apply.

Live retains 3,451 B, above the task's acceptable 3,000 B minimum. The 8,192 B preferred floor is not reached. More aggressive grouping would make helper consumers acquire the engine or large session UI; additional surface deferral would broaden focus, export and recovery risk. This trim keeps those boundaries intact.

## Rejected approaches

- Terser with two compression passes increased both target bundles; the dependency and experiment were removed.
- Native private fields saved only about 250 B in the LiveSession chunk for extensive class churn; reverted.
- Deferring stencil rows saved less than 1 KB and introduced another loading boundary; reverted.
- Engine restructuring and budget increases are outside scope.

## UX review

The toolbar, phone sheet, inspector, camera, cursor, keyboard and export flows are unchanged. No controls were added. Grouping changes compression and requests, rather than when surfaces mount. Trace highlighting retains only reached nodes and sent edges, in first-use order; copies and parked nodes do not become highlights before arrival. The existing lazy registry and recovery controls are unchanged.

## Verification

The new production-build test pins the six startup chunks, keeps the canvas at two additional chunks, excludes journey construction from eager Live, and enforces 8,192 B canvas / 3,000 B Live headroom. Restoring the old bundling configuration makes it fail (378,313 B canvas versus 374,808 B ceiling). A deliberate path-kind mutation also fails the new path regression. Targeted build/trace tests: 46 passed.

Production build, size and bundle gate pass. Final broader verification results are recorded in the PR. No golden is intentionally changed.

## Every JavaScript chunk

All emitted JavaScript is listed below, including locale catalogs. A dash means the chunk was merged away or introduced. Repeated stable names show each constituent size (sorted) in one cell, since the benchmark strips hashes from names. Deltas compare their total gzip bytes. This table uses the unrounded gzip-level-9 bundle-gate measurements.

| Chunk name                       |   Before gzip B | After gzip B | Delta B |
| -------------------------------- | --------------: | -----------: | ------: |
| AdmissionFields.js               |            2987 |         2964 |     -23 |
| AiPanel.js                       |           16652 |        16409 |    -243 |
| AnnotationFormatting.js          |             310 |          317 |       7 |
| AnnotationPanel.js               |            2304 |         2290 |     -14 |
| BottleneckCallout.js             |             916 |          907 |      -9 |
| BrandGlyph.js                    |             918 |          916 |      -2 |
| BreakerReadout.js                |             869 |          845 |     -24 |
| CallPills.js                     |            2951 |         2931 |     -20 |
| CallWaitFields.js                |            4132 |         4095 |     -37 |
| CanvasReadouts.js                |            1779 |         1752 |     -27 |
| CanvasView.js                    |          115458 |       114785 |    -673 |
| CapacityAnalysis.js              |             126 |          126 |       0 |
| CapacityPanel.js                 |            5870 |         5820 |     -50 |
| ChecksCard.js                    |            6804 |         6781 |     -23 |
| ChecksMarkers.js                 |            1167 |         1156 |     -11 |
| ColorPickerModal.js              |            2205 |         2169 |     -36 |
| DiagramPanel.js                  |            1886 |         1870 |     -16 |
| DockedLive.js                    |            1032 |         1008 |     -24 |
| EdgeAdvanced.js                  |            1225 |         1215 |     -10 |
| EdgeDetailSection.js             |             868 |          860 |      -8 |
| EdgeMessages.js                  |            1604 |         1390 |    -214 |
| EdgePanel.js                     |            6716 |         6467 |    -249 |
| EdgeRouteHandles.js              |            5189 |         5147 |     -42 |
| EditCapacity.js                  |             883 |          847 |     -36 |
| EmbedView.js                     |            2329 |         2089 |    -240 |
| EventLog.js                      |            1076 |         1057 |     -19 |
| ExampleDetails.js                |           14328 |        14310 |     -18 |
| ExamplesDialog.js                |             813 |          790 |     -23 |
| FrameDetail.js                   |            5031 |         5007 |     -24 |
| GalleryView.js                   |            8059 |         8035 |     -24 |
| GroupPanel.js                    |            1581 |         1557 |     -24 |
| HostEmbedView.js                 |            5531 |         5506 |     -25 |
| HoverHistory.js                  |             465 |          444 |     -21 |
| HtmlExportDialog.js              |            4247 |         4185 |     -62 |
| ImportReportDialog.js            |            4182 |         3947 |    -235 |
| InjectDialog.js                  |             850 |          845 |      -5 |
| Layout.js                        |             301 |          301 |       0 |
| LibraryDialog.js                 |            2568 |         2544 |     -24 |
| LiveMoreItems.js                 |            1557 |         1531 |     -26 |
| LiveSession.js                   |           56581 |        54714 |   -1867 |
| MarkdownEditor.js                |            1134 |         1127 |      -7 |
| MarkdownView.js                  |            4903 |         4893 |     -10 |
| MessageFields.js                 |            4429 |         4401 |     -28 |
| MultiPanel.js                    |            3979 |         3960 |     -19 |
| NodeDetailSections.js            |            4783 |         4799 |      16 |
| NodeDetails.js                   |            4646 |         4397 |    -249 |
| NodeIdentity.js                  |            1259 |         1238 |     -21 |
| NodeSettings.js                  |            1864 |         1669 |    -195 |
| NoteCallout.js                   |            5147 |         5134 |     -13 |
| OnDeviceInput.js                 |           16171 |        16145 |     -26 |
| PaletteDialog.js                 |            6353 |         6289 |     -64 |
| PasswordField.js                 |            1311 |         1286 |     -25 |
| PropsEditor.js                   |             960 |          934 |     -26 |
| Recorder.js                      |            5829 |         5798 |     -31 |
| RouteSwatch.js                   |             450 |          457 |       7 |
| SequenceDialog.js                |            6486 |         6468 |     -18 |
| SettingsCard.js                  |            1321 |         1320 |      -1 |
| ShapeIcon.js                     |            1123 |         1121 |      -2 |
| ShareChooser.js                  |            1814 |         1788 |     -26 |
| ShortcutsDialog.js               |            3310 |         3271 |     -39 |
| SimPanel.js                      |            9609 |         9623 |      14 |
| SimulationFields.js              |            7099 |         6870 |    -229 |
| SlowTimeline.js                  |             603 |          602 |      -1 |
| Sparkline.js                     |            1490 |         1473 |     -17 |
| StorageDialog.js                 |            1109 |         1083 |     -26 |
| ThreadCeiling.js                 |             787 |          783 |      -4 |
| Timeline.js                      |            2667 |         2653 |     -14 |
| TraceCard.js                     |            3805 |         3784 |     -21 |
| TroubleCallout.js                |            2459 |         2425 |     -34 |
| TutorialApp.js                   |           16600 |        16358 |    -242 |
| TutorialsView.js                 |             992 |          978 |     -14 |
| WebMcpBridge.js                  |            4801 |         4537 |    -264 |
| addConsumer.js                   |             449 |          450 |       1 |
| affordableTimeout.js             |             340 |          338 |      -2 |
| aks-app-config-key-vault.js      |            1751 |         1751 |       0 |
| annotations.js                   |            1286 |            — |   -1286 |
| api-route-table.js               |            1915 |         1915 |       0 |
| ar.js                            |           91553 |        91553 |       0 |
| attachmentGeometry.js            |            1448 |         1449 |       1 |
| autoscaling-basics.js            |            1878 |         1878 |       0 |
| aws-serverless-orders.js         |            3291 |         3291 |       0 |
| azure-service-bus-integration.js |            2209 |         2209 |       0 |
| bg.js                            |           90882 |        90882 |       0 |
| bidi.js                          |              59 |           59 |       0 |
| black-friday-commerce.js         |            6928 |         6928 |       0 |
| blocking-call.js                 |            1340 |         1340 |       0 |
| boundaryPlacement.js             |             503 |          503 |       0 |
| branch-to-datacentre.js          |            2076 |         2076 |       0 |
| breaker.js                       |            8323 |            — |   -8323 |
| brokerVocabulary.js              |             206 |          216 |      10 |
| browser.js                       |           29678 |        29678 |       0 |
| callFailureRate.js               |             152 |          152 |       0 |
| calloutPlacement.js              |             484 |          484 |       0 |
| canvas-shared.js                 |           99699 |        99447 |    -252 |
| capacity.js                      |            8255 |         8211 |     -44 |
| capacityInputs.js                |             345 |            — |    -345 |
| capacityModel.js                 |            3869 |         3821 |     -48 |
| capacityPlanning.js              |            1402 |         1390 |     -12 |
| capacityView.js                  |            2504 |         2501 |      -3 |
| carriedTypes.js                  |            1630 |         1592 |     -38 |
| cdc-analytics.js                 |            1665 |         1665 |       0 |
| cell-based-bookings.js           |            4108 |         4108 |       0 |
| checks.js                        |            1563 |         1563 |       0 |
| clearOnPrivate.js                |             271 |          279 |       8 |
| cloud-run-timetable-api.js       |            1186 |         1186 |       0 |
| cloudMessages.js                 |             728 |          734 |       6 |
| codec.js                         |             761 |            — |    -761 |
| colors.js                        |             624 |            — |    -624 |
| connectTarget.js                 |             751 |          749 |      -2 |
| context.js                       |      972 + 1356 |   972 + 1373 |      17 |
| contoso-dmz.js                   |            1455 |         1455 |       0 |
| copyForAi.js                     |             485 |          474 |     -11 |
| cqrs-event-sourcing.js           |            2237 |         2237 |       0 |
| cs.js                            |           82134 |        82134 |       0 |
| da.js                            |           76578 |        76578 |       0 |
| de.js                            |           82612 |        82612 |       0 |
| deadLetter.js                    |             336 |          336 |       0 |
| defaults.js                      |            5411 |            — |   -5411 |
| delivery-dispatch.js             |            5039 |         5039 |       0 |
| diagramReader.js                 |             126 |            — |    -126 |
| dialogs.js                       |            8223 |         8179 |     -44 |
| dropbox.js                       |            1904 |         1909 |       5 |
| edgeChoices.js                   |             389 |          396 |       7 |
| editTransactions.js              |              72 |           72 |       0 |
| el.js                            |           95873 |        95873 |       0 |
| embed-webfonts.js                |            2928 |         2928 |       0 |
| es.js                            |           78932 |        78932 |       0 |
| et.js                            |           78849 |        78849 |       0 |
| ev-charging-network.js           |            5218 |         5218 |       0 |
| event-driven-data-platform.js    |            3060 |         3060 |       0 |
| evidence.js                      |            1809 |         1813 |       4 |
| evidenceClient.js                |            1964 |         1706 |    -258 |
| evidenceMerge.js                 |             725 |          725 |       0 |
| examples.js                      |            4545 |         4528 |     -17 |
| execute.js                       |             349 |          349 |       0 |
| explanation.js                   |            2300 |         2275 |     -25 |
| extendedGeometry.js              |            1550 |         1550 |       0 |
| faultWords.js                    |            2007 |         2005 |      -2 |
| faults.js                        |             553 |          555 |       2 |
| features.js                      |             341 |          346 |       5 |
| fi.js                            |           80554 |        80554 |       0 |
| fields.js                        |            1946 |         1919 |     -27 |
| fileMessages.js                  |            1333 |         1342 |       9 |
| format.js                        | 236 + 595 + 742 |    242 + 745 |    -586 |
| fr.js                            |           81176 |        81176 |       0 |
| frameCapture.js                  |             219 |          219 |       0 |
| fuzzy.js                         |             625 |          625 |       0 |
| gcp-streaming-analytics.js       |            1920 |         1920 |       0 |
| gdrive.js                        |            2988 |         2989 |       1 |
| groupHierarchy.js                |            1844 |            — |   -1844 |
| he.js                            |           82460 |        82460 |       0 |
| healthWindow.js                  |             838 |            — |    -838 |
| helpers.js                       |             230 |          230 |       0 |
| hi.js                            |           92564 |        92564 |       0 |
| hoverSummary.js                  |            3952 |         3920 |     -32 |
| hr.js                            |           79794 |        79794 |       0 |
| hu.js                            |           85242 |        85242 |       0 |
| hybrid-enterprise-network.js     |            4281 |         4281 |       0 |
| i18n.js                          |             288 |            — |    -288 |
| icons.js                         |      296 + 1173 |   296 + 1171 |      -2 |
| id.js                            |           74544 |        74544 |       0 |
| image.js                         |            3296 |         3271 |     -25 |
| imageClone.js                    |            5153 |         5153 |       0 |
| import.js                        |     4348 + 5332 |  4344 + 5309 |     -27 |
| importMessages.js                |            3327 |         3335 |       8 |
| importOutcome.js                 |             163 |          163 |       0 |
| index.js                         |          111332 |       109576 |   -1756 |
| infer.js                         |            2544 |         2544 |       0 |
| inline-rate-limit.js             |             687 |          687 |       0 |
| it.js                            |           78816 |        78816 |       0 |
| ja.js                            |           88940 |        88940 |       0 |
| journey.js                       |               — |         1359 |    1359 |
| jsx-runtime.js                   |             456 |            — |    -456 |
| kafka-order-pipeline.js          |            2205 |         2205 |       0 |
| ko.js                            |           85370 |        85370 |       0 |
| languageDialogRoot.js            |            2085 |         2057 |     -28 |
| lazyEdgePanel.js                 |            1416 |         1167 |    -249 |
| lazyLoad.js                      |             693 |            — |    -693 |
| lazyNodeSections.js              |            1247 |         1004 |    -243 |
| lazyPropsEditor.js               |             631 |          421 |    -210 |
| lazyTutorial.js                  |            1050 |          888 |    -162 |
| list.js                          |             146 |          153 |       7 |
| live-helpers.js                  |               — |         3120 |    3120 |
| load.js                          |            2748 |         2532 |    -216 |
| lt.js                            |           81723 |        81723 |       0 |
| lv.js                            |           80995 |        80995 |       0 |
| machine.js                       |             361 |            — |    -361 |
| mapping.js                       |            3332 |         3333 |       1 |
| markdownKeys.js                  |            1275 |         1275 |       0 |
| measured-order-capacity.js       |            1088 |         1088 |       0 |
| messageTypes.js                  |            4251 |         4239 |     -12 |
| metadata.js                      |            1257 |         1259 |       2 |
| native.js                        |           29981 |        36814 |    6833 |
| nb.js                            |           76250 |        76250 |       0 |
| nightly-batch-elt.js             |            1946 |         1946 |       0 |
| nl.js                            |           78365 |        78365 |       0 |
| notification-fanout.js           |            2441 |         2441 |       0 |
| oauth.js                         |            2612 |         2616 |       4 |
| observability-pipeline.js        |            4296 |         4296 |       0 |
| onedrive.js                      |            1927 |         1933 |       6 |
| ops.js                           |           14369 |        14324 |     -45 |
| outbox-saga-checkout.js          |            2648 |         2648 |       0 |
| partitions-vs-subscriptions.js   |            1201 |         1201 |       0 |
| passwordCrypto.js                |             617 |          615 |      -2 |
| passwordDialogs.js               |            1967 |         1929 |     -38 |
| payments-ledger.js               |            5190 |         5190 |       0 |
| pick.js                          |            1830 |         1830 |       0 |
| pipeline.js                      |           48777 |        48801 |      24 |
| pl.js                            |           83362 |        83362 |       0 |
| playback-model.js                |               — |        16209 |   16209 |
| preload-helper.js                |             798 |          798 |       0 |
| presentation.js                  |            4225 |         4226 |       1 |
| pt-BR.js                         |           78004 |        78004 |       0 |
| pt-PT.js                         |           78335 |        78335 |       0 |
| rag-assistant.js                 |            2355 |         2355 |       0 |
| react-dom.js                     |            1550 |            — |   -1550 |
| react.js                         |            3153 |            — |   -3153 |
| readoutDiagram.js                |             649 |            — |    -649 |
| recommendations-feature-store.js |            6263 |         6263 |       0 |
| replay.js                        |           10483 |        10530 |      47 |
| replayControls.js                |             446 |            — |    -446 |
| requestCheckCache.js             |            1766 |         1505 |    -261 |
| requestFindings.js               |           10068 |        10023 |     -45 |
| requestRouting.js                |            3815 |            — |   -3815 |
| resiliencePresets.js             |             508 |          508 |       0 |
| retry-storm.js                   |            2358 |         2358 |       0 |
| ro.js                            |           80899 |        80899 |       0 |
| rolldown-runtime.js              |             428 |          428 |       0 |
| routeWords.js                    |             647 |          662 |      15 |
| ru.js                            |           94137 |        94137 |       0 |
| run.js                           |           14380 |        14404 |      24 |
| runChartMath.js                  |             756 |          753 |      -3 |
| scale-on-busy-threads.js         |            1373 |         1373 |       0 |
| scalingFindings.js               |            1623 |         1621 |      -2 |
| scalingMetric.js                 |             156 |          156 |       0 |
| scalingPlanText.js               |            2434 |         2440 |       6 |
| scalingPlanner.js                |            4946 |         4961 |      15 |
| scalingReason.js                 |            1552 |         1552 |       0 |
| selectionSummary.js              |             394 |          403 |       9 |
| serverless-burst-buffer.js       |            1439 |         1439 |       0 |
| shaped.js                        |            1502 |         1503 |       1 |
| shareCrypto.js                   |             330 |          327 |      -3 |
| shared-api-quotas.js             |            1529 |         1529 |       0 |
| shared-worker-pool.js            |            1173 |         1173 |       0 |
| shell-runtime.js                 |               — |         7503 |    7503 |
| simFields.js                     |            1606 |         1545 |     -61 |
| simulation.js                    |           43160 |        43130 |     -30 |
| simulationEdges.js               |               — |          570 |     570 |
| size.js                          |             205 |            — |    -205 |
| sk.js                            |           82484 |        82484 |       0 |
| sl.js                            |           80589 |        80589 |       0 |
| slow-payment-provider.js         |            1868 |         1868 |       0 |
| sr-Latn.js                       |           79241 |        79241 |       0 |
| stencils.js                      |            1054 |         1053 |      -1 |
| storage.js                       |             509 |            — |    -509 |
| storm.js                         |            1052 |            — |   -1052 |
| sv.js                            |           77259 |        77259 |       0 |
| th.js                            |           88714 |        88714 |       0 |
| threadStore.js                   |            1324 |         1326 |       2 |
| toast.js                         |             509 |            — |    -509 |
| toolList.js                      |            7693 |         7676 |     -17 |
| topology.js                      |            3355 |            — |   -3355 |
| tr.js                            |           80449 |        80449 |       0 |
| troubleTracker.js                |            4988 |         4945 |     -43 |
| tutorialRuntimeFixture.js        |             767 |          769 |       2 |
| tutorials.js                     |           33967 |        33957 |     -10 |
| ui.js                            |           30069 |        30015 |     -54 |
| uk.js                            |           93671 |        93671 |       0 |
| useEditTransaction.js            |             296 |          303 |       7 |
| useFloatingPlacement.js          |            1224 |         1232 |       8 |
| useLiveFixes.js                  |            5172 |         4909 |    -263 |
| vendor-edge-storefront.js        |             625 |          625 |       0 |
| vi.js                            |           80757 |        80757 |       0 |
| video-on-demand-pipeline.js      |            5472 |         5472 |       0 |
| waitingDetails.js                |             451 |          448 |      -3 |
| webhook-ingestion.js             |            2393 |         2393 |       0 |
| where-the-time-goes.js           |            1264 |         1264 |       0 |
| workBudget.js                    |            1091 |         1091 |       0 |
| write.js                         |     2612 + 4351 |  2605 + 4324 |     -34 |
| zh-CN.js                         |           81322 |        81322 |       0 |
| zh-TW.js                         |           82156 |        82156 |       0 |
| zone-outage-drill.js             |            1155 |         1155 |       0 |
