## Canvas first view and Live session trim (3)

Measured on Node 24.22.0 against starting commit 63fba7a708937297ef662e723e8600885fd15b87. Gzip level 9, production build without test hooks. Budgets, reserves, startup chunk pins and the skill ZIP cap stay fixed.

| Download          | Before gzip B | After gzip B | Saved B | Headroom B |
| ----------------- | ------------: | -----------: | ------: | ---------: |
| Startup           |        158852 |       158840 |      12 |      18160 |
| Canvas first view |        374300 |       370599 |    3701 |      12401 |
| Live additional   |        131614 |       128500 |    3114 |       6500 |
| All JavaScript    |       4280718 |      4282232 |   -1514 |          — |

The canvas is 4209 B below the 374808 B reserve ceiling, satisfying the additional 4096 B margin. Live has 6500 B of headroom, above the accepted 6144 B fallback.

## Changes and rejected approaches

Camera bounds no longer import frame-edge decoration geometry. Playback inputs no longer bring capacity-panel formatting, presets and row selection into Live. Recording state stays synchronous while format selection and download/error messages load with the existing Recorder chunk. The phone overflow controls now live inside the existing overflow download instead of being constructed eagerly as children.

The stencil library is closed by default. Its contents download on opening; its Gallery queue handler remains synchronous and works before the library ever opens. While pending, its search accepts text. The loaded search inherits that query and keyboard ownership only when the pending input still owned focus; another control keeps any focus the person moved to it. Folding after loading preserves the library instance and its query. Exports skip this editing UI. Failed downloads use the shared, eager Retry path. Annotation tiles remain synchronous.

Rejected minimap deferral: its library implementation remains in React Flow's shared module, so the experiment saved only a few hundred bytes and added a recovery boundary. The run chart already loads with on-demand node details. Reaching the preferred 8192 B Live floor still needs 1692 B: this trim keeps first-frame badges, renderer, playback controls and controllers synchronous, and leaves the pending engine split alone. No additional replay or focus boundary was added to chase that remainder.

Total JavaScript grows by 1514 gzip bytes because the separate dictionaries and loading/search shell cost bytes; the initial canvas and Live closures lose 3701 B and 3114 B respectively. This is a first-use download trim, with all functionality retained.

## UX review

No control is added. The canvas remains editable while optional UI downloads; node move and pane cursors keep their existing meanings. The library immediately exposes a search field, so early typing cannot run canvas shortcuts. Its loading status uses existing translations. Closing during loading does not reopen it on completion. Gallery handoff, file/image export, phone speed and Inputs, keyboard ownership and failed-download Retry have explicit browser regressions.

## Verification

Production build, entry/viewer/Forge size checks, regeneration and i18n validation pass. Parity checks all 3178 goldens with zero changed, added, missing or stale. The broad test run passed 14126 tests and found one stale spy import after the playback helper move; updating the spy to its new source preserves every operation-count assertion, and its targeted rerun passes all 10 tests. No full suite is repeated for that correction.

The initial browser run passed all 51 existing lazy-surface contracts plus the Gallery handoff regression; three new tests exposed setup assumptions that were corrected (untouched examples are not autosaved, Select returns focus to the canvas, and the Live pane uses grab). The loading search was then kept interactive, with explicit Retry focus and ownership-preserving handoff. Browser reruns and the five-repeat Linux load run were refused with exit 75 while another gate held all 12 shared slots. These final browser checks remain for CI.

The 27-test bundle suite passes; the final reserve check and all 60 camera/detail unit cases pass after the last helper move. The reserve regression tightens the existing test to an additional 4096 B below the canvas reserve and at least 6144 B of Live headroom. It also excludes the deferred source modules and phone controls from their eager closures. Temporarily restoring each of the five eager dependencies (frame decoration, capacity helpers, recording helpers, stencil contents and phone controls) fails this regression; all five mutations were restored. No parity golden is changed or re-recorded.

## Every JavaScript chunk

All emitted JavaScript chunks are listed, including unchanged locale catalogs. Repeated stable names list each constituent in sorted order; the delta compares their totals. A dash marks a newly introduced or removed chunk.

| Chunk                            | Before gzip B | After gzip B | Delta B |
| -------------------------------- | ------------: | -----------: | ------: |
| AdmissionFields.js               |          2957 |         2955 |      -2 |
| AiPanel.js                       |         16422 |        16420 |      -2 |
| AnnotationFormatting.js          |           316 |          316 |       0 |
| AnnotationPanel.js               |          2275 |         2275 |       0 |
| BottleneckCallout.js             |           907 |          906 |      -1 |
| BrandGlyph.js                    |           916 |          917 |       1 |
| BreakerReadout.js                |           846 |          846 |       0 |
| CallPills.js                     |          2933 |         2935 |       2 |
| CallWaitFields.js                |          4082 |         4081 |      -1 |
| CanvasReadouts.js                |          1756 |         1756 |       0 |
| CanvasView.js                    |        115838 |       112175 |   -3663 |
| CapacityAnalysis.js              |           126 |          126 |       0 |
| CapacityPanel.js                 |          5823 |         5832 |       9 |
| ChecksCard.js                    |          6770 |         6773 |       3 |
| ChecksMarkers.js                 |          1156 |         1160 |       4 |
| ColorPickerModal.js              |          2157 |         2157 |       0 |
| DiagramPanel.js                  |          1854 |         1856 |       2 |
| DockedLive.js                    |           994 |          992 |      -2 |
| EdgeAdvanced.js                  |          1216 |         1214 |      -2 |
| EdgeDetailSection.js             |           862 |          864 |       2 |
| EdgeMessages.js                  |          1391 |         1390 |      -1 |
| EdgePanel.js                     |          6455 |         6446 |      -9 |
| EdgeRouteHandles.js              |          5127 |         5126 |      -1 |
| EditCapacity.js                  |           852 |          875 |      23 |
| EmbedView.js                     |          2088 |         2083 |      -5 |
| EventLog.js                      |          1060 |         1060 |       0 |
| ExampleDetails.js                |         14291 |        14296 |       5 |
| ExamplesDialog.js                |           765 |          769 |       4 |
| FrameDetail.js                   |          6695 |         8211 |    1516 |
| GalleryView.js                   |          8022 |         8023 |       1 |
| GroupPanel.js                    |          1542 |         1548 |       6 |
| HostEmbedView.js                 |          5495 |         5495 |       0 |
| HoverHistory.js                  |           448 |          445 |      -3 |
| HtmlExportDialog.js              |          4175 |         4175 |       0 |
| ImportReportDialog.js            |          3940 |         3943 |       3 |
| InjectDialog.js                  |           850 |          851 |       1 |
| Layout.js                        |           301 |          300 |      -1 |
| LibraryDialog.js                 |          2530 |         2530 |       0 |
| LiveMoreItems.js                 |          1534 |         1875 |     341 |
| LiveSession.js                   |         54738 |        53840 |    -898 |
| MarkdownEditor.js                |          1128 |         1126 |      -2 |
| MarkdownView.js                  |          4893 |         4894 |       1 |
| MessageFields.js                 |          4400 |         4398 |      -2 |
| MultiPanel.js                    |          3944 |         3943 |      -1 |
| NodeDetailSections.js            |          4811 |         4804 |      -7 |
| NodeDetails.js                   |          4409 |         4404 |      -5 |
| NodeIdentity.js                  |          1225 |         1223 |      -2 |
| NodeSettings.js                  |          1671 |         1670 |      -1 |
| NoteCallout.js                   |          5133 |         5133 |       0 |
| OnDeviceInput.js                 |         16142 |        16141 |      -1 |
| Palette.js                       |             — |         3123 |    3123 |
| PaletteDialog.js                 |          6341 |         6341 |       0 |
| PasswordField.js                 |          1273 |         1273 |       0 |
| PropsEditor.js                   |           920 |          919 |      -1 |
| Recorder.js                      |          5753 |         6481 |     728 |
| RouteSwatch.js                   |           457 |          452 |      -5 |
| SequenceDialog.js                |          6455 |         6453 |      -2 |
| SettingsCard.js                  |          1304 |         1305 |       1 |
| ShapeIcon.js                     |          1120 |         1123 |       3 |
| ShareChooser.js                  |          1777 |         1780 |       3 |
| ShortcutsDialog.js               |          3278 |         3274 |      -4 |
| SimPanel.js                      |          9626 |         9628 |       2 |
| SimulationFields.js              |          6866 |         6864 |      -2 |
| SlowTimeline.js                  |           601 |          602 |       1 |
| Sparkline.js                     |          1479 |         1479 |       0 |
| StorageDialog.js                 |          1071 |         1070 |      -1 |
| ThreadCeiling.js                 |           786 |          784 |      -2 |
| Timeline.js                      |          2658 |         2659 |       1 |
| Toaster.js                       |          3788 |         3788 |       0 |
| TraceCard.js                     |          3789 |         3788 |      -1 |
| TroubleCallout.js                |          2429 |         2429 |       0 |
| TutorialApp.js                   |         16365 |        16367 |       2 |
| TutorialsView.js                 |           967 |          970 |       3 |
| WebMcpBridge.js                  |          4527 |         4525 |      -2 |
| addConsumer.js                   |           448 |          450 |       2 |
| affordableTimeout.js             |           336 |          340 |       4 |
| aks-app-config-key-vault.js      |          1751 |         1751 |       0 |
| api-route-table.js               |          1915 |         1915 |       0 |
| ar.js                            |         91674 |        91674 |       0 |
| attachmentGeometry.js            |          1448 |         1447 |      -1 |
| autoscaling-basics.js            |          1878 |         1878 |       0 |
| aws-serverless-orders.js         |          3291 |         3291 |       0 |
| azure-service-bus-integration.js |          2209 |         2209 |       0 |
| bg.js                            |         90988 |        90988 |       0 |
| bidi.js                          |            59 |           59 |       0 |
| black-friday-commerce.js         |          6928 |         6928 |       0 |
| blocking-call.js                 |          1340 |         1340 |       0 |
| boundaryPlacement.js             |           503 |          503 |       0 |
| branch-to-datacentre.js          |          2076 |         2076 |       0 |
| brokerVocabulary.js              |           217 |          216 |      -1 |
| browser.js                       |         29678 |        29678 |       0 |
| callFailureRate.js               |           152 |          152 |       0 |
| calloutPlacement.js              |           488 |          488 |       0 |
| canvas-shared.js                 |         99610 |        99584 |     -26 |
| capacity.js                      |          8211 |         8211 |       0 |
| capacityModel.js                 |          3822 |         2597 |   -1225 |
| capacityPlanning.js              |          1391 |         1390 |      -1 |
| capacityView.js                  |          2504 |         2515 |      11 |
| carriedTypes.js                  |          1597 |         1598 |       1 |
| cdc-analytics.js                 |          1665 |         1665 |       0 |
| cell-based-bookings.js           |          4108 |         4108 |       0 |
| checks.js                        |          1561 |         1563 |       2 |
| clearOnPrivate.js                |           277 |          276 |      -1 |
| cloud-run-timetable-api.js       |          1186 |         1186 |       0 |
| cloudMessages.js                 |           736 |          735 |      -1 |
| connectTarget.js                 |           748 |          748 |       0 |
| context.js                       |    972 + 1360 |   972 + 1359 |      -1 |
| contoso-dmz.js                   |          1455 |         1455 |       0 |
| copyForAi.js                     |           464 |          462 |      -2 |
| cqrs-event-sourcing.js           |          2237 |         2237 |       0 |
| cs.js                            |         82254 |        82254 |       0 |
| da.js                            |         76676 |        76676 |       0 |
| de.js                            |         82716 |        82716 |       0 |
| deadLetter.js                    |           336 |          336 |       0 |
| delivery-dispatch.js             |          5039 |         5039 |       0 |
| dialogs.js                       |          8160 |         8160 |       0 |
| dropbox.js                       |          1891 |         1890 |      -1 |
| edgeChoices.js                   |           395 |          397 |       2 |
| editTransactions.js              |            72 |           72 |       0 |
| el.js                            |         95987 |        95987 |       0 |
| embed-webfonts.js                |          2928 |         2928 |       0 |
| es.js                            |         79020 |        79020 |       0 |
| et.js                            |         78938 |        78938 |       0 |
| ev-charging-network.js           |          5218 |         5218 |       0 |
| event-driven-data-platform.js    |          3060 |         3060 |       0 |
| evidence.js                      |          1809 |         1812 |       3 |
| evidenceClient.js                |          1707 |         1707 |       0 |
| evidenceMerge.js                 |           725 |          725 |       0 |
| examples.js                      |          1287 |         1287 |       0 |
| execute.js                       |           347 |          347 |       0 |
| explanation.js                   |          2277 |         2274 |      -3 |
| extendedGeometry.js              |          1550 |         1550 |       0 |
| faultWords.js                    |          2014 |         2016 |       2 |
| faults.js                        |           554 |          555 |       1 |
| features.js                      |           348 |          348 |       0 |
| fi.js                            |         80651 |        80651 |       0 |
| fields.js                        |          1903 |         1904 |       1 |
| fileMessages.js                  |          1344 |         1343 |      -1 |
| format.js                        |     245 + 728 |    244 + 731 |       2 |
| fr.js                            |         81270 |        81270 |       0 |
| frameCapture.js                  |           335 |          335 |       0 |
| fuzzy.js                         |           625 |          625 |       0 |
| gcp-streaming-analytics.js       |          1920 |         1920 |       0 |
| gdrive.js                        |          2975 |         2974 |      -1 |
| he.js                            |         82552 |        82552 |       0 |
| helpers.js                       |           230 |          230 |       0 |
| hi.js                            |         92655 |        92655 |       0 |
| hoverSummary.js                  |          3929 |         3922 |      -7 |
| hr.js                            |         79910 |        79910 |       0 |
| hu.js                            |         85358 |        85358 |       0 |
| hybrid-enterprise-network.js     |          4281 |         4281 |       0 |
| icons.js                         |    296 + 1172 |   299 + 1173 |       4 |
| id.js                            |         74662 |        74662 |       0 |
| image.js                         |          3265 |         3268 |       3 |
| imageClone.js                    |          5153 |         5153 |       0 |
| import.js                        |   4347 + 5315 |  4347 + 5313 |      -2 |
| importMessages.js                |          3334 |         3334 |       0 |
| importOutcome.js                 |           162 |          163 |       1 |
| index.js                         |           417 |          417 |       0 |
| infer.js                         |          2544 |         2544 |       0 |
| inline-rate-limit.js             |           687 |          687 |       0 |
| it.js                            |         78891 |        78891 |       0 |
| ja.js                            |         89027 |        89027 |       0 |
| journey.js                       |          1361 |         1359 |      -2 |
| kafka-order-pipeline.js          |          2205 |         2205 |       0 |
| ko.js                            |         85458 |        85458 |       0 |
| languageDialogRoot.js            |          2046 |         2044 |      -2 |
| lazyEdgePanel.js                 |          1167 |         1165 |      -2 |
| lazyNodeSections.js              |          1011 |         1009 |      -2 |
| lazyPropsEditor.js               |           426 |          426 |       0 |
| lazyTutorial.js                  |           893 |          891 |      -2 |
| list.js                          |           153 |          152 |      -1 |
| live-helpers.js                  |          3124 |         3121 |      -3 |
| load.js                          |          2539 |         2538 |      -1 |
| lt.js                            |         81818 |        81818 |       0 |
| lv.js                            |         81135 |        81135 |       0 |
| mapping.js                       |          3333 |         3334 |       1 |
| markdownKeys.js                  |          1275 |         1275 |       0 |
| measured-order-capacity.js       |          1088 |         1088 |       0 |
| messageTypes.js                  |          4238 |         4239 |       1 |
| metadata.js                      |          1260 |         1260 |       0 |
| native.js                        |         37445 |        37445 |       0 |
| nb.js                            |         76329 |        76329 |       0 |
| nightly-batch-elt.js             |          1946 |         1946 |       0 |
| nl.js                            |         78476 |        78476 |       0 |
| notification-fanout.js           |          2441 |         2441 |       0 |
| oauth.js                         |          2612 |         2610 |      -2 |
| observability-pipeline.js        |          4296 |         4296 |       0 |
| onedrive.js                      |          1912 |         1912 |       0 |
| ops.js                           |         14274 |        14274 |       0 |
| outbox-saga-checkout.js          |          2648 |         2648 |       0 |
| partitions-vs-subscriptions.js   |          1201 |         1201 |       0 |
| passwordCrypto.js                |           622 |          622 |       0 |
| passwordDialogs.js               |          1913 |         1915 |       2 |
| payments-ledger.js               |          5190 |         5190 |       0 |
| pick.js                          |          1830 |         1830 |       0 |
| pipeline.js                      |         48791 |        48792 |       1 |
| pl.js                            |         83480 |        83480 |       0 |
| playback-model.js                |         16209 |        16211 |       2 |
| playbackInputs.js                |             — |         1611 |    1611 |
| preload-helper.js                |           798 |          798 |       0 |
| presentation.js                  |          4228 |         4232 |       4 |
| pt-BR.js                         |         78080 |        78080 |       0 |
| pt-PT.js                         |         78423 |        78423 |       0 |
| rag-assistant.js                 |          2355 |         2355 |       0 |
| recommendations-feature-store.js |          6263 |         6263 |       0 |
| replay.js                        |         10530 |        10522 |      -8 |
| requestCheckCache.js             |          1501 |         1500 |      -1 |
| requestFindings.js               |         10028 |        10026 |      -2 |
| resiliencePresets.js             |           508 |          508 |       0 |
| retry-storm.js                   |          2358 |         2358 |       0 |
| ro.js                            |         80984 |        80984 |       0 |
| rolldown-runtime.js              |           428 |          428 |       0 |
| routeWords.js                    |           663 |          661 |      -2 |
| ru.js                            |         94260 |        94260 |       0 |
| run.js                           |         14407 |        14404 |      -3 |
| runChartMath.js                  |           753 |          757 |       4 |
| scale-on-busy-threads.js         |          1373 |         1373 |       0 |
| scalingFindings.js               |          1620 |         1620 |       0 |
| scalingMetric.js                 |           156 |          156 |       0 |
| scalingPlanText.js               |          2441 |         2443 |       2 |
| scalingPlanner.js                |          4951 |         4948 |      -3 |
| scalingReason.js                 |          1552 |         1552 |       0 |
| selectionSummary.js              |           406 |          409 |       3 |
| serverless-burst-buffer.js       |          1439 |         1439 |       0 |
| shaped.js                        |          1502 |         1504 |       2 |
| shareCrypto.js                   |           336 |          336 |       0 |
| shared-api-quotas.js             |          1529 |         1529 |       0 |
| shared-worker-pool.js            |          1173 |         1173 |       0 |
| shell-runtime.js                 |        118477 |       118465 |     -12 |
| simFields.js                     |          1534 |         1535 |       1 |
| simulation.js                    |         43170 |        43169 |      -1 |
| simulationEdges.js               |           573 |          571 |      -2 |
| sk.js                            |         82602 |        82602 |       0 |
| sl.js                            |         80698 |        80698 |       0 |
| slow-payment-provider.js         |          1868 |         1868 |       0 |
| sr-Latn.js                       |         79332 |        79332 |       0 |
| stencils.js                      |          1053 |         1057 |       4 |
| sv.js                            |         77360 |        77360 |       0 |
| th.js                            |         88856 |        88856 |       0 |
| threadStore.js                   |          1314 |         1316 |       2 |
| toolList.js                      |          7654 |         7655 |       1 |
| tr.js                            |         80546 |        80546 |       0 |
| troubleTracker.js                |          4943 |         4937 |      -6 |
| tutorialRuntimeFixture.js        |           770 |          770 |       0 |
| tutorials.js                     |         33971 |        33972 |       1 |
| ui.js                            |         30012 |        30023 |      11 |
| uk.js                            |         93816 |        93816 |       0 |
| useEditTransaction.js            |           303 |          303 |       0 |
| useFloatingPlacement.js          |          1232 |         1234 |       2 |
| useLiveFixes.js                  |          4910 |         4903 |      -7 |
| vendor-edge-storefront.js        |           625 |          625 |       0 |
| vi.js                            |         80840 |        80840 |       0 |
| video-on-demand-pipeline.js      |          5472 |         5472 |       0 |
| waitingDetails.js                |           448 |          447 |      -1 |
| webhook-ingestion.js             |          2393 |         2393 |       0 |
| where-the-time-goes.js           |          1264 |         1264 |       0 |
| workBudget.js                    |          1091 |         1093 |       2 |
| write.js                         |   2606 + 4325 |  2603 + 4326 |      -2 |
| zh-CN.js                         |         81412 |        81412 |       0 |
| zh-TW.js                         |         82238 |        82238 |       0 |
| zone-outage-drill.js             |          1155 |         1155 |       0 |
