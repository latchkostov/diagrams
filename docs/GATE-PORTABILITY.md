# Gate portability and flake audit

Native macOS cannot be run from this Windows checkout. Native macOS and Windows
Nightly jobs run units and every production E2E project with zero retries. The
platform spec also supplies Mac/Windows browser inputs on every host; this checks
application branches and pinch events, but cannot emulate native text editing.

## Reported Mac failures

| Original case                         | Classification                                | Correction / coverage                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| autoscaling:256                       | Test bug                                      | Primary-modifier Undo/select-all use ControlOrMeta.                                                                                                                                |
| checks-simulations:458                | Test bug (host input/measurement assumptions) | Use native caret boundary keys (Command+Right on Mac, End elsewhere), portable modifiers, and the existing same-run CPU measurement/progress barrier.                              |
| collab-c1a:756                        | Test bug                                      | Native paste uses ControlOrMeta.                                                                                                                                                   |
| drawing-basics:119, wheel             | Test bug                                      | Pinch sends literal Control+wheel on every OS; the device descriptor now reports the host OS. Mac-like input proves the app accepts ctrl+wheel.                                    |
| drawing-basics:553, Shift+2           | Product bug                                   | A deferred Inspector pan could overwrite the requested zoom. Selection zoom now owns the viewport and refines after pane measurements; the probe issues Shift+2 before the reveal. |
| i18n:286, context menus (de/ar/en-XA) | Test bug                                      | Control-click is a macOS context-menu gesture, not multi-select. Use ControlOrMeta for selection and grouping.                                                                     |
| keda:57                               | Test bug                                      | Native Undo uses ControlOrMeta.                                                                                                                                                    |
| layout:131, title chip                | Test bug                                      | Literal Control models wheel pinch, including on macOS.                                                                                                                            |
| planning-p3:52 and :163               | Test bug                                      | Portable Undo and native select-all in numeric inputs.                                                                                                                             |
| relationships:60                      | Product bug plus test synchronization         | A highlighted hint rounds below 4.5:1; use stronger hint ink and test composited RGB in both themes. Audit after the menu's entrance fade finishes.                                |
| round7-polish:39                      | Test bug                                      | Multi-select uses ControlOrMeta rather than macOS Control-click.                                                                                                                   |
| i18n:1567, RTL quick-add              | Product bug                                   | Recompute the menu's physical anchor and reserve its room after an Inspector/pane resize. A paused-clock rapid-add case reproduces the old overlap in RTL.                         |
| canvasMessages:62 and :120            | Test bug                                      | Pin the platform per test and cover both Mac and non-Mac labels.                                                                                                                   |
| englishAiMessages:199                 | Test bug                                      | Pin both native label variants rather than reading the test host.                                                                                                                  |
| localGate                             | Test bug / tooling portability                | Replace Bash/flock tests with portable Node logic and OS-owned socket lifecycle tests.                                                                                             |
| terraform:922                         | Test bug                                      | Count parsed-input access, including descriptor reads, at sizes 64 and 512. A deliberate quadratic scan fails the unchanged 24x bound.                                             |

## Load-dependent failures

- Annotation and canvas export/import: the file download precedes its lazy notification. Await
  the export completion before starting the import so a late export toast cannot
  replace the import's. Keep the complete round-trip assertions.
- Cross-tab promotion: install the context clock before navigation and pause at the
  leading time across all tabs/frames. Sampling only the invoking tab can remain in
  another tab's past indefinitely. The clock helper has deterministic skew/rejection tests.
- Pending private save: keep the canvas mounted before invoking file operations and
  stop toast expiry before releasing the held provider request. The refusal and
  unchanged cloud document/bindings are still required.
- Library autosave: finish the deferred Inspector reveal before freezing its timers.
- Image cancellation: hold an actual clone continuation after visible progress, then
  exercise keyboard focus and cancellation. Release that continuation after Cancel/Esc.
  The 300-node successful export and byte-parity workload remain.
- Exported-file storage: seed the actual file origin before the viewer runs; sibling
  file origins are not guaranteed to share storage.
- Slow motion: advance the installed clock rather than spending real time sampling
  forty captions. Keep all frozen-clock, particle and caption assertions.
- The 300-node byte-parity workload is split into independent SVG and PNG cases; neither repeats the unasserted fifth clone. Palette keyboard tests exercise a native-file leaf; image work remains in its dedicated suite.
- Collaboration network assertions identify only the dev server's exact same-origin HMR handshake as infrastructure; other sockets and off-origin requests still fail. Tooltip render measurements drain queued idle preloads and their React commits before counting.
- Vite ignores generated report HTML under tests/.output; output writes no longer
  broadcast reloads or consume source-watcher work during the suite.
- The 24-worker sweep also caught Lab interactions starting before the loaded
  room had been fitted: a join can publish its document after the empty camera's
  startup fit. Request Fit for the loaded room and await its measured completion.
  A held-font regression proves that a stationary camera alone cannot signal readiness.
  Benchmark geometry reads run
  together and its off-pane case leaves initial selection to the separate selection
  case, keeping the fit/recovery assertions within the unchanged hang backstop.
- A held module/font request already guarantees the image cancellation boundary.
  Do not add CPU throttling to that case; the separate large-export workload retains
  throttling. Combining both consumed action time while simply opening File under load.
- Decode/encode fault tests use the existing two-node export-contract Lab fixture.
  Their injected browser error and subsequent successful retry remain mandatory;
  wait on the actual injected browser call before asserting error reporting. Cold
  cloning must not consume that assertion's clock before the fault is even reached.
- Sequential SVG/PNG equivalence comparisons await measured fit completion and
  use reduced motion. The trace showed the viewport matrix moving from 4.0904 to
  4.02009 between clones; bytes remain compared exactly, with no new normalization.
- A native tab close need not deliver its best-effort goodbye. Deliberately drop
  that packet and advance the fake clock by the protocol's presence TTL plus its
  heartbeat period. The test checks the real expiry fallback rather than expecting
  a guaranteed disconnect within a real-time assertion window.

Deliberate regressions caught the removed modifier rule, missing Mac label pinning,
lagging-clock sampling, a disabled HEAD guard, quadratic Terraform scanning, and the
old RTL menu anchoring. No retries, longer assertion timeouts or rewritten goldens
are used as fixes.

## Last seven Nightly runs

Read with `gh run list -R latchkostov/diagrams --workflow nightly.yml --limit 7`
and `gh run view <id> --log-failed`. Line numbers below are those recorded by each
run. Older failures include guards already present on the starting master (live
readiness, lazy templates, main-thread CPU measurements, storage and fit readiness);
they remain in the full suite, rather than being excluded. The newest run was
cancelled: its list contains the failures recorded before cancellation.

### [39002987366](https://github.com/latchkostov/diagrams/actions/runs/39002987366)

- `perf.spec.ts:318:3 › perf: interactions › a node's tooltip shows and hides without rendering the canvas @dev`
- `html-export.spec.ts:277:3 › Interactive HTML export › leaves the reader's storage alone, and the reader's preferences out`
- `image-slices.spec.ts:188:3 › image export in slices › draws what html-to-image draws, byte for byte: 300 nodes @dev`
- `palette-command.spec.ts:224:3 › command palette › prefixes narrow to actions, nodes or stencils, and the footer buttons type them`
- `slowmo.spec.ts:132:3 › slow motion › from a node: the background freezes, at most 4 dots move, captions tell each hop`
- `privacy-audit.spec.ts:226:3 › a pending example save follows promotion privacy before provider loading (default)`
- `privacy-audit.spec.ts:226:3 › a pending example save follows promotion privacy before provider loading (switch)`
- `annotations.spec.ts:505:3 › annotations › export JSON and import it back keeps every annotation`
- `collab-c1a.spec.ts:115:1 › isolated editors preserve a pending inspector edit, scope Undo/Redo, and handle remote deletion`
- `collab-c1a.spec.ts:209:1 › room recovery preserves an existing local autosave across reload and rejoin`
- `image-slices.spec.ts:237:1 › a long image export keeps the page painting, shows its progress and can be cancelled`
- `image-slices.spec.ts:301:3 › PNG and SVG export work without OffscreenCanvas`
- `sharing-privacy.spec.ts:172:1 › a link dialog closed because the diagram turned private meanwhile offers Interactive HTML`
- `sharing-privacy.spec.ts:222:1 › the refusal's Interactive HTML… explains itself when no diagram is open`

### [38851345020](https://github.com/latchkostov/diagrams/actions/runs/38851345020)

- `private-diagrams.spec.ts:440:3 › a promoted copy cancels a pending bound cloud save when Private is switched on`
- `private-diagrams.spec.ts:440:3 › a promoted copy cancels a pending bound cloud save when Private is inherited`
- `canvas.spec.ts:90:3 › canvas › export preserves the complete diagram contract before and after import and reload`
- `layout.spec.ts:82:7 › layout audit (light) › every public fixture is overlap-free at fit view (light, part 1 of 8)`
- `privacy-audit.spec.ts:226:3 › a pending example save follows promotion privacy before provider loading (switch)`
- `privacy-audit.spec.ts:226:3 › a pending example save follows promotion privacy before provider loading (default)`
- `live.spec.ts:189:3 › live view › Start a storm here creates a simulation that persists across reload`
- `text-fields.spec.ts:588:3 › renaming in the inspector › live inspector naming preserves edits to the active saved simulation`
- `capacity.spec.ts:457:3 › fourth review capacity regressions › Apply fix transfers keyboard focus to the stable announcement in both modes`
- `interop.spec.ts:704:3 › leaving an unedited example releases its completed Save destination`
- `interop.spec.ts:704:3 › leaving an unedited example releases its pending Save destination`
- `live.spec.ts:468:3 › live view › Esc backs out of the simulation panel one level at a time, then leaves live`

### [38682178888](https://github.com/latchkostov/diagrams/actions/runs/38682178888)

- `i18n.spec.ts:1001:5 › File dialogs in de › cloud blocked sign-in, consent, admin, expiry and full-storage prompts`
- `i18n.spec.ts:1001:5 › File dialogs in ar › cloud blocked sign-in, consent, admin, expiry and full-storage prompts`
- `i18n.spec.ts:1001:5 › File dialogs in en-XA › cloud blocked sign-in, consent, admin, expiry and full-storage prompts`
- `layout.spec.ts:141:3 › auto-layout never produces overlaps (part 1 of 4)`
- `privacy-audit.spec.ts:136:3 › the address bar and history › a public diagram turned private while playing drops its simulation from the address bar`
- `privacy-audit.spec.ts:150:3 › requests and third parties › a private diagram's session: no request leaves the origin or carries its words`
- `text-fields.spec.ts:605:3 › renaming in the inspector › presenting live and read-only embeds open no editor on a double-click`
- `checks-ui.spec.ts:306:1 › typing a label is as responsive while checks run as with them held`
- `ai-howto.spec.ts:93:3 › with WebMCP › with a conversation, the how-to folds to one link`
- `polish.spec.ts:131:3 › polish › React Flow's credit stays visible, clear of the live bar and the first-run hint`
- `private-diagrams.spec.ts:630:1 › Private P1 diagrams keep privacy through native, legacy and Interactive HTML downloads`
- `private-diagrams.spec.ts:572:1 › a private diagram gets no password link: the rows are off, and an open dialog closes without copying`
- `share-chooser.spec.ts:412:1 › Share… stays with its diagram: another one opening closes it, loaded or still downloading`
- `share-chooser.spec.ts:456:1 › a public embed closes when the diagram turns private in another tab: it never becomes the private kind`
- `share-chooser.spec.ts:480:1 › an embed supplied by your app stays open when another tab makes the diagram private`
- `checks-simulations.spec.ts:454:3 › a long run › typing is as responsive while simulations play as with none playing`
- `checks-simulations.spec.ts:118:1 › Run simulations: progress, counts on the finding, an edit hides them and Undo brings them back`
- `checks-simulations.spec.ts:344:3 › a long run › Stop, Esc, closing the card and an edit each stop it at once`
- `checks-simulations.spec.ts:382:3 › a long run › Ctrl+K and the canvas right-click stop it the same way, and play it again`
- `checks-simulations.spec.ts:409:3 › a long run › leaving editing, another view or another diagram stops a run Ctrl+K started; Run plays the canvas shown`
- `interop.spec.ts:57:1 › a failed image export keeps the format in its error`

### [38512271096](https://github.com/latchkostov/diagrams/actions/runs/38512271096)

- `ai-dictation.spec.ts:10:3 › Dictate › start, interim words, final words at the caret, stop`
- `polish.spec.ts:92:3 › polish › edge labels draw above particles and below badges while live`
- `sharing-privacy.spec.ts:171:1 › a link dialog closed because the diagram turned private meanwhile offers Interactive HTML`
- `lazy-examples.spec.ts:315:1 › a pending example that loads applies its own URL state`
- `lazy-examples.spec.ts:250:1 › switching back before a pending example loads keeps the live link`
- `privacy-audit.spec.ts:319:3 › this browser's storage › a tab that hears of the wipe late writes nothing, and deletes nothing made since`
- `checks-simulations.spec.ts:210:1 › Run simulations from Ctrl+K and the canvas right-click: opens the card and plays; what it finds has no fix`
- `checks-simulations.spec.ts:359:3 › a long run › Ctrl+K and the canvas right-click stop it the same way, and play it again`
- `checks-simulations.spec.ts:386:3 › a long run › leaving editing, another view or another diagram stops a run Ctrl+K started; Run plays the canvas shown`
- `html-export.spec.ts:34:3 › Interactive HTML export › exports the Kafka example as one file that plays offline, with zero requests`
- `html-export.spec.ts:77:3 › Interactive HTML export › the file plays inside an <iframe> too, still with zero requests`
- `share-chooser.spec.ts:297:1 › the first Import report offers New diagrams are private, once; Clear everything asks again`
- `share-chooser.spec.ts:449:1 › a public embed closes when the diagram turns private in another tab: it never becomes the private kind`
- `drawing-basics.spec.ts:242:3 › drawing basics › the inspector waits for pointer-up: it never opens under a drag`

### [38347798389](https://github.com/latchkostov/diagrams/actions/runs/38347798389)

- `capacity.spec.ts:75:3 › inputs & capacity › Save to simulation persists the inputs across a reload`
- `host-embed.spec.ts:593:3 › host-supplied embeds: timing and requests › a pending src-json response can't replace a newer diagram, and an oversized one stops downloading`
- `round13-polish.spec.ts:170:1 › an Undo toast goes because Ctrl+Z undoes, long before it would expire, and the node is back in its boundary`
- `checks-ui.spec.ts:306:1 › typing a label is as responsive while checks run as with them held`
- `live.spec.ts:452:3 › live view › live node menus lead with live actions and stay within the chrome budget`
- `undo-selection.spec.ts:230:3 › undo and the selection › quick-add after a pending edit restores its source selection`
- `live-render.spec.ts:215:5 › live rendering, worker path › a waiting note stops the march like pausing does (the sim clock stands still)`
- `live-render.spec.ts:359:3 › a particle worker that can't start hands over to the main thread › its script never arrives (an error event)`
- `live-render.spec.ts:366:3 › a particle worker that can't start hands over to the main thread › its constructor throws (a CSP, disabled workers, Trusted Types)`
- `live-render.spec.ts:320:3 › live rendering stays off the main thread › the worker path draws nothing on the main thread and runs no endless animation while live`

### [38205286592](https://github.com/latchkostov/diagrams/actions/runs/38205286592)

- `live-render.spec.ts:126:5 › live rendering, worker path › a traced message's label is drawn above the pills where the hooks place it`
- `slowmo.spec.ts:225:3 › slow motion › Esc goes back to live exactly where it left off, paused or playing`
- `trace.spec.ts:97:3 › message trace › a replacement trace resets scroll-following even when its row count is unchanged`

### [38193703281](https://github.com/latchkostov/diagrams/actions/runs/38193703281)

- `smoke.spec.ts:17:3 › smoke › canvas ────────────────────────────────────`
- `live.spec.ts:390:3 › live view › saved simulation survives immediate diagram navigation`
