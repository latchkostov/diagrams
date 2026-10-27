## Canvas first view and Live session trim (3)

Measured on Node 24.22.0 against starting commit 63fba7a708937297ef662e723e8600885fd15b87. Gzip level 9, production build without test hooks. Budgets, reserves, startup chunk pins and the skill ZIP cap stay fixed.

| Download          | Before gzip B | After gzip B | Saved B | Headroom B |
| ----------------- | ------------: | -----------: | ------: | ---------: |
| Startup           |        158852 |       158853 |      -1 |      18147 |
| Canvas first view |        374300 |       370641 |    3659 |      12359 |
| Live additional   |        131614 |       128512 |    3102 |       6488 |
| All JavaScript    |       4280718 |      4282372 |   -1654 |          — |

The canvas is 4167 B below the 374808 B reserve ceiling, satisfying the additional 4096 B margin. Live has 6488 B of headroom, above the accepted 6144 B fallback.

## Changes and rejected approaches

Camera bounds no longer import frame-edge decoration geometry. Playback inputs no longer bring capacity-panel formatting, presets and row selection into Live. Recording state stays synchronous while format selection and download/error messages load with the existing Recorder chunk. The phone overflow controls now live inside the existing overflow download instead of being constructed eagerly as children.

The stencil library is closed by default. Its contents download on opening; its Gallery queue handler remains synchronous and works before the library ever opens. While pending, its search accepts text. The loaded search inherits that query and keyboard ownership only when the pending input still owned focus; another control keeps any focus the person moved to it. Folding after loading preserves the library instance and its query. Exports skip this editing UI. Failed downloads use the shared, eager Retry path. Annotation tiles remain synchronous.

The wrapper retains the original Palette's memoization so canvas edits do not render it. Escape capture defers to a focused search with text, allowing its handler to clear the query before a second Escape closes the flyout. When the download arrives under a modal, the loader waits on the existing modal registry until focus has returned, retaining the actual input the modal captured. This adds no separate lifecycle flags or timers.

Rejected minimap deferral: its library implementation remains in React Flow's shared module, so the experiment saved only a few hundred bytes and added a recovery boundary. The run chart already loads with on-demand node details. Reaching the preferred 8192 B Live floor still needs 1704 B: this trim keeps first-frame badges, renderer, playback controls and controllers synchronous, and leaves the pending engine split alone. No additional replay or focus boundary was added to chase that remainder.

Total JavaScript grows by 1654 gzip bytes because the separate dictionaries and loading/search shell cost bytes; the initial canvas and Live closures lose 3659 B and 3102 B respectively. This is a first-use download trim, with all functionality retained.

## UX review

No control is added. The canvas remains editable while optional UI downloads; node move and pane cursors keep their existing meanings. The library immediately exposes a search field, so early typing cannot run canvas shortcuts. Its loading status uses existing translations. Closing during loading does not reopen it on completion. Gallery handoff, file/image export, phone speed and Inputs, keyboard ownership and failed-download Retry have explicit browser regressions.

## Verification

Production build, entry/viewer/Forge size checks, regeneration and i18n validation pass. Parity checks all 3178 goldens with zero changed, added, missing or stale. The broad test run passed 14126 tests and found one stale spy import after the playback helper move; updating the spy to its new source preserves every operation-count assertion, and its targeted rerun passes all 10 tests. No full suite is repeated for that correction.

The initial browser run passed all 51 existing lazy-surface contracts plus the Gallery handoff regression; three new tests exposed setup assumptions that were corrected (untouched examples are not autosaved, Select returns focus to the canvas, and the Live pane uses grab). The loading search was then kept interactive, with explicit Retry focus and ownership-preserving handoff.

The single full Linux gate completed all CI projects: 14137 unit/heavy tests passed; 2874 browser cases passed, five failed and none were flaky. The failures exposed Escape capture closing the library before query clearing, plus four render-count assertions caused by the wrapper losing memoization. The follow-up fixes both without changing assertions. A new held-chunk modal-return test also failed on the unfixed code at the search-focus assertion, confirming that replacing the modal's original input loses its return target. The loader now retains that input until the modal returns focus. Targeted post-fix browser and five-repeat Linux runs were refused with exit 75 while another gate held all 12 slots; those final browser checks remain for CI. No gate lock was bypassed and no full suite was repeated.

Full gate (before the focused corrections):

```text
SUMMARY: c956b3660b1cdec084bab5429e2cd42a248dae1d | unit={"passed":14137,"failed":0,"skipped":13} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2874,"failed":5,"flaky":0,"skipped":1} gate_failures=1
```

The 27-test bundle suite passes; the final reserve check and all 60 camera/detail unit cases pass after the last helper move. The reserve regression tightens the existing test to an additional 4096 B below the canvas reserve and at least 6144 B of Live headroom. It also excludes the deferred source modules and phone controls from their eager closures. Temporarily restoring each of the five eager dependencies (frame decoration, capacity helpers, recording helpers, stencil contents and phone controls) fails this regression; all five mutations were restored. No parity golden is changed or re-recorded.

## Every JavaScript chunk

All emitted JavaScript chunks are listed, including unchanged locale catalogs. Repeated stable names list each constituent in sorted order; the delta compares their totals. A dash marks a newly introduced or removed chunk.

| Chunk                            | Before gzip B | After gzip B | Delta B |
| -------------------------------- | ------------: | -----------: | ------: |
| AdmissionFields.js               |          2957 |         2957 |       0 |
| AiPanel.js                       |         16422 |        16421 |      -1 |
| AnnotationFormatting.js          |           316 |          316 |       0 |
| AnnotationPanel.js               |          2275 |         2275 |       0 |
| BottleneckCallout.js             |           907 |          907 |       0 |
| BrandGlyph.js                    |           916 |          919 |       3 |
| BreakerReadout.js                |           846 |          844 |      -2 |
| CallPills.js                     |          2933 |         2930 |      -3 |
| CallWaitFields.js                |          4082 |         4086 |       4 |
| CanvasReadouts.js                |          1756 |         1754 |      -2 |
| CanvasView.js                    |        115838 |       112206 |   -3632 |
| CapacityAnalysis.js              |           126 |          126 |       0 |
| CapacityPanel.js                 |          5823 |         5834 |      11 |
| ChecksCard.js                    |          6770 |         6768 |      -2 |
| ChecksMarkers.js                 |          1156 |         1157 |       1 |
| ColorPickerModal.js              |          2157 |         2160 |       3 |
| DiagramPanel.js                  |          1854 |         1854 |       0 |
| DockedLive.js                    |           994 |          994 |       0 |
| EdgeAdvanced.js                  |          1216 |         1218 |       2 |
| EdgeDetailSection.js             |           862 |          859 |      -3 |
| EdgeMessages.js                  |          1391 |         1389 |      -2 |
| EdgePanel.js                     |          6455 |         6457 |       2 |
| EdgeRouteHandles.js              |          5127 |         5122 |      -5 |
| EditCapacity.js                  |           852 |          876 |      24 |
| EmbedView.js                     |          2088 |         2088 |       0 |
| EventLog.js                      |          1060 |         1059 |      -1 |
| ExampleDetails.js                |         14291 |        14290 |      -1 |
| ExamplesDialog.js                |           765 |          768 |       3 |
| FrameDetail.js                   |          6695 |         8209 |    1514 |
| GalleryView.js                   |          8022 |         8022 |       0 |
| GroupPanel.js                    |          1542 |         1548 |       6 |
| HostEmbedView.js                 |          5495 |         5496 |       1 |
| HoverHistory.js                  |           448 |          445 |      -3 |
| HtmlExportDialog.js              |          4175 |         4177 |       2 |
| ImportReportDialog.js            |          3940 |         3943 |       3 |
| InjectDialog.js                  |           850 |          849 |      -1 |
| Layout.js                        |           301 |          300 |      -1 |
| LibraryDialog.js                 |          2530 |         2531 |       1 |
| LiveMoreItems.js                 |          1534 |         1871 |     337 |
| LiveSession.js                   |         54738 |        53844 |    -894 |
| MarkdownEditor.js                |          1128 |         1125 |      -3 |
| MarkdownView.js                  |          4893 |         4894 |       1 |
| MessageFields.js                 |          4400 |         4399 |      -1 |
| MultiPanel.js                    |          3944 |         3948 |       4 |
| NodeDetailSections.js            |          4811 |         4802 |      -9 |
| NodeDetails.js                   |          4409 |         4401 |      -8 |
| NodeIdentity.js                  |          1225 |         1222 |      -3 |
| NodeSettings.js                  |          1671 |         1675 |       4 |
| NoteCallout.js                   |          5133 |         5130 |      -3 |
| OnDeviceInput.js                 |         16142 |        16142 |       0 |
| Palette.js                       |             — |         3204 |    3204 |
| PaletteDialog.js                 |          6341 |         6340 |      -1 |
| PasswordField.js                 |          1273 |         1273 |       0 |
| PropsEditor.js                   |           920 |          919 |      -1 |
| Recorder.js                      |          5753 |         6479 |     726 |
| RouteSwatch.js                   |           457 |          458 |       1 |
| SequenceDialog.js                |          6455 |         6452 |      -3 |
| SettingsCard.js                  |          1304 |         1304 |       0 |
| ShapeIcon.js                     |          1120 |         1123 |       3 |
| ShareChooser.js                  |          1777 |         1778 |       1 |
| ShortcutsDialog.js               |          3278 |         3278 |       0 |
| SimPanel.js                      |          9626 |         9624 |      -2 |
| SimulationFields.js              |          6866 |         6872 |       6 |
| SlowTimeline.js                  |           601 |          603 |       2 |
| Sparkline.js                     |          1479 |         1477 |      -2 |
| StorageDialog.js                 |          1071 |         1071 |       0 |
| ThreadCeiling.js                 |           786 |          784 |      -2 |
| Timeline.js                      |          2658 |         2657 |      -1 |
| Toaster.js                       |          3788 |         3788 |       0 |
| TraceCard.js                     |          3789 |         3790 |       1 |
| TroubleCallout.js                |          2429 |         2428 |      -1 |
| TutorialApp.js                   |         16365 |        16362 |      -3 |
| TutorialsView.js                 |           967 |          967 |       0 |
| WebMcpBridge.js                  |          4527 |         4525 |      -2 |
| addConsumer.js                   |           448 |          451 |       3 |
| affordableTimeout.js             |           336 |          339 |       3 |
| aks-app-config-key-vault.js      |          1751 |         1751 |       0 |
| api-route-table.js               |          1915 |         1915 |       0 |
| ar.js                            |         91674 |        91674 |       0 |
| attachmentGeometry.js            |          1448 |         1446 |      -2 |
| autoscaling-basics.js            |          1878 |         1878 |       0 |
| aws-serverless-orders.js         |          3291 |         3291 |       0 |
| azure-service-bus-integration.js |          2209 |         2209 |       0 |
| bg.js                            |         90988 |        90988 |       0 |
| bidi.js                          |            59 |           59 |       0 |
| black-friday-commerce.js         |          6928 |         6928 |       0 |
| blocking-call.js                 |          1340 |         1340 |       0 |
| boundaryPlacement.js             |           503 |          503 |       0 |
| branch-to-datacentre.js          |          2076 |         2076 |       0 |
| brokerVocabulary.js              |           217 |          217 |       0 |
| browser.js                       |         29678 |        29678 |       0 |
| callFailureRate.js               |           152 |          152 |       0 |
| calloutPlacement.js              |           488 |          488 |       0 |
| canvas-shared.js                 |         99610 |        99582 |     -28 |
| capacity.js                      |          8211 |         8210 |      -1 |
| capacityModel.js                 |          3822 |         2600 |   -1222 |
| capacityPlanning.js              |          1391 |         1390 |      -1 |
| capacityView.js                  |          2504 |         2516 |      12 |
| carriedTypes.js                  |          1597 |         1594 |      -3 |
| cdc-analytics.js                 |          1665 |         1665 |       0 |
| cell-based-bookings.js           |          4108 |         4108 |       0 |
| checks.js                        |          1561 |         1563 |       2 |
| clearOnPrivate.js                |           277 |          277 |       0 |
| cloud-run-timetable-api.js       |          1186 |         1186 |       0 |
| cloudMessages.js                 |           736 |          737 |       1 |
| connectTarget.js                 |           748 |          747 |      -1 |
| context.js                       |    972 + 1360 |   972 + 1360 |       0 |
| contoso-dmz.js                   |          1455 |         1455 |       0 |
| copyForAi.js                     |           464 |          462 |      -2 |
| cqrs-event-sourcing.js           |          2237 |         2237 |       0 |
| cs.js                            |         82254 |        82254 |       0 |
| da.js                            |         76676 |        76676 |       0 |
| de.js                            |         82716 |        82716 |       0 |
| deadLetter.js                    |           336 |          336 |       0 |
| delivery-dispatch.js             |          5039 |         5039 |       0 |
| dialogs.js                       |          8160 |         8158 |      -2 |
| dropbox.js                       |          1891 |         1892 |       1 |
| edgeChoices.js                   |           395 |          396 |       1 |
| editTransactions.js              |            72 |           72 |       0 |
| el.js                            |         95987 |        95987 |       0 |
| embed-webfonts.js                |          2928 |         2928 |       0 |
| es.js                            |         79020 |        79020 |       0 |
| et.js                            |         78938 |        78938 |       0 |
| ev-charging-network.js           |          5218 |         5218 |       0 |
| event-driven-data-platform.js    |          3060 |         3060 |       0 |
| evidence.js                      |          1809 |         1810 |       1 |
| evidenceClient.js                |          1707 |         1704 |      -3 |
| evidenceMerge.js                 |           725 |          725 |       0 |
| examples.js                      |          1287 |         1287 |       0 |
| execute.js                       |           347 |          345 |      -2 |
| explanation.js                   |          2277 |         2276 |      -1 |
| extendedGeometry.js              |          1550 |         1550 |       0 |
| faultWords.js                    |          2014 |         2017 |       3 |
| faults.js                        |           554 |          556 |       2 |
| features.js                      |           348 |          348 |       0 |
| fi.js                            |         80651 |        80651 |       0 |
| fields.js                        |          1903 |         1906 |       3 |
| fileMessages.js                  |          1344 |         1346 |       2 |
| format.js                        |     245 + 728 |    244 + 733 |       4 |
| fr.js                            |         81270 |        81270 |       0 |
| frameCapture.js                  |           335 |          335 |       0 |
| fuzzy.js                         |           625 |          625 |       0 |
| gcp-streaming-analytics.js       |          1920 |         1920 |       0 |
| gdrive.js                        |          2975 |         2975 |       0 |
| he.js                            |         82552 |        82552 |       0 |
| helpers.js                       |           230 |          230 |       0 |
| hi.js                            |         92655 |        92655 |       0 |
| hoverSummary.js                  |          3929 |         3925 |      -4 |
| hr.js                            |         79910 |        79910 |       0 |
| hu.js                            |         85358 |        85358 |       0 |
| hybrid-enterprise-network.js     |          4281 |         4281 |       0 |
| icons.js                         |    296 + 1172 |   297 + 1175 |       4 |
| id.js                            |         74662 |        74662 |       0 |
| image.js                         |          3265 |         3265 |       0 |
| imageClone.js                    |          5153 |         5153 |       0 |
| import.js                        |   4347 + 5315 |  4346 + 5316 |       0 |
| importMessages.js                |          3334 |         3334 |       0 |
| importOutcome.js                 |           162 |          165 |       3 |
| index.js                         |           417 |          416 |      -1 |
| infer.js                         |          2544 |         2544 |       0 |
| inline-rate-limit.js             |           687 |          687 |       0 |
| it.js                            |         78891 |        78891 |       0 |
| ja.js                            |         89027 |        89027 |       0 |
| journey.js                       |          1361 |         1358 |      -3 |
| kafka-order-pipeline.js          |          2205 |         2205 |       0 |
| ko.js                            |         85458 |        85458 |       0 |
| languageDialogRoot.js            |          2046 |         2046 |       0 |
| lazyEdgePanel.js                 |          1167 |         1168 |       1 |
| lazyNodeSections.js              |          1011 |         1003 |      -8 |
| lazyPropsEditor.js               |           426 |          424 |      -2 |
| lazyTutorial.js                  |           893 |          889 |      -4 |
| list.js                          |           153 |          152 |      -1 |
| live-helpers.js                  |          3124 |         3122 |      -2 |
| load.js                          |          2539 |         2538 |      -1 |
| lt.js                            |         81818 |        81818 |       0 |
| lv.js                            |         81135 |        81135 |       0 |
| mapping.js                       |          3333 |         3336 |       3 |
| markdownKeys.js                  |          1275 |         1275 |       0 |
| measured-order-capacity.js       |          1088 |         1088 |       0 |
| messageTypes.js                  |          4238 |         4239 |       1 |
| metadata.js                      |          1260 |         1259 |      -1 |
| native.js                        |         37445 |        37445 |       0 |
| nb.js                            |         76329 |        76329 |       0 |
| nightly-batch-elt.js             |          1946 |         1946 |       0 |
| nl.js                            |         78476 |        78476 |       0 |
| notification-fanout.js           |          2441 |         2441 |       0 |
| oauth.js                         |          2612 |         2613 |       1 |
| observability-pipeline.js        |          4296 |         4296 |       0 |
| onedrive.js                      |          1912 |         1913 |       1 |
| ops.js                           |         14274 |        14275 |       1 |
| outbox-saga-checkout.js          |          2648 |         2648 |       0 |
| partitions-vs-subscriptions.js   |          1201 |         1201 |       0 |
| passwordCrypto.js                |           622 |          622 |       0 |
| passwordDialogs.js               |          1913 |         1914 |       1 |
| payments-ledger.js               |          5190 |         5190 |       0 |
| pick.js                          |          1830 |         1830 |       0 |
| pipeline.js                      |         48791 |        48793 |       2 |
| pl.js                            |         83480 |        83480 |       0 |
| playback-model.js                |         16209 |        16210 |       1 |
| playbackInputs.js                |             — |         1612 |    1612 |
| preload-helper.js                |           798 |          798 |       0 |
| presentation.js                  |          4228 |         4233 |       5 |
| pt-BR.js                         |         78080 |        78080 |       0 |
| pt-PT.js                         |         78423 |        78423 |       0 |
| rag-assistant.js                 |          2355 |         2355 |       0 |
| recommendations-feature-store.js |          6263 |         6263 |       0 |
| replay.js                        |         10530 |        10523 |      -7 |
| requestCheckCache.js             |          1501 |         1500 |      -1 |
| requestFindings.js               |         10028 |        10024 |      -4 |
| resiliencePresets.js             |           508 |          508 |       0 |
| retry-storm.js                   |          2358 |         2358 |       0 |
| ro.js                            |         80984 |        80984 |       0 |
| rolldown-runtime.js              |           428 |          428 |       0 |
| routeWords.js                    |           663 |          662 |      -1 |
| ru.js                            |         94260 |        94260 |       0 |
| run.js                           |         14407 |        14408 |       1 |
| runChartMath.js                  |           753 |          755 |       2 |
| scale-on-busy-threads.js         |          1373 |         1373 |       0 |
| scalingFindings.js               |          1620 |         1621 |       1 |
| scalingMetric.js                 |           156 |          156 |       0 |
| scalingPlanText.js               |          2441 |         2441 |       0 |
| scalingPlanner.js                |          4951 |         4947 |      -4 |
| scalingReason.js                 |          1552 |         1552 |       0 |
| selectionSummary.js              |           406 |          409 |       3 |
| serverless-burst-buffer.js       |          1439 |         1439 |       0 |
| shaped.js                        |          1502 |         1500 |      -2 |
| shareCrypto.js                   |           336 |          335 |      -1 |
| shared-api-quotas.js             |          1529 |         1529 |       0 |
| shared-worker-pool.js            |          1173 |         1173 |       0 |
| shell-runtime.js                 |        118477 |       118479 |       2 |
| simFields.js                     |          1534 |         1535 |       1 |
| simulation.js                    |         43170 |        43170 |       0 |
| simulationEdges.js               |           573 |          572 |      -1 |
| sk.js                            |         82602 |        82602 |       0 |
| sl.js                            |         80698 |        80698 |       0 |
| slow-payment-provider.js         |          1868 |         1868 |       0 |
| sr-Latn.js                       |         79332 |        79332 |       0 |
| stencils.js                      |          1053 |         1054 |       1 |
| sv.js                            |         77360 |        77360 |       0 |
| th.js                            |         88856 |        88856 |       0 |
| threadStore.js                   |          1314 |         1316 |       2 |
| toolList.js                      |          7654 |         7653 |      -1 |
| tr.js                            |         80546 |        80546 |       0 |
| troubleTracker.js                |          4943 |         4941 |      -2 |
| tutorialRuntimeFixture.js        |           770 |          769 |      -1 |
| tutorials.js                     |         33971 |        33970 |      -1 |
| ui.js                            |         30012 |        30031 |      19 |
| uk.js                            |         93816 |        93816 |       0 |
| useEditTransaction.js            |           303 |          303 |       0 |
| useFloatingPlacement.js          |          1232 |         1233 |       1 |
| useLiveFixes.js                  |          4910 |         4901 |      -9 |
| vendor-edge-storefront.js        |           625 |          625 |       0 |
| vi.js                            |         80840 |        80840 |       0 |
| video-on-demand-pipeline.js      |          5472 |         5472 |       0 |
| waitingDetails.js                |           448 |          450 |       2 |
| webhook-ingestion.js             |          2393 |         2393 |       0 |
| where-the-time-goes.js           |          1264 |         1264 |       0 |
| workBudget.js                    |          1091 |         1093 |       2 |
| write.js                         |   2606 + 4325 |  2607 + 4325 |       1 |
| zh-CN.js                         |         81412 |        81412 |       0 |
| zh-TW.js                         |         82238 |        82238 |       0 |
| zone-outage-drill.js             |          1155 |         1155 |       0 |
