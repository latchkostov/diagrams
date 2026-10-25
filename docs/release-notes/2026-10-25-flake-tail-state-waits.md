## CI: state-based waits for recent flake candidates

The held-discovery recording regression now observes the real MediaRecorder at construction and waits for recording state and its first nonempty encoded chunk before Stop. The recording indicator appears before the encoder starts; stopping in that gap cancels the take, and stopping before any frame is encoded can leave an empty clip. The test controls the countdown and encoder startup with a fake clock, preserving the held discovery request, exact title, recording indicator, download and discard assertions. The existing narration-capture regression shares the observer and keeps its real captured/encoded pixel assertions.

No product code, UI text, timeouts, retries or output goldens change, and existing assertions remain intact. Output parity and broad suites are left to CI under the fix-round instruction to run only targeted specs. No golden is re-recorded.

The [fresh 60-run flake report](../design-review/2026-10-25-flake-tail-ci-evidence.md) ranks segment keyboard input first (eight failing attempts), the held connection Inspector Escape case second (two), and the discovery-recording case fourth (one). Health recovery has no failing attempt in that window. The Inspector failure is a [product Escape-priority investigation](../backlog/2026-10-25-held-inspector-escape-focus.md), not a reason to wait until the deferred name field exists before typing.

## Reproduction and mutation evidence

All browser runs use the lockfile-pinned Playwright 1.64.1 noble Linux image, production E2E builds, explicit ports 6760–6764 and zero retries.

Baseline `972aab1f8dff3cfabeb18fc52b7dc0eae43369e3`, six workers sharing three CPUs, 30 repeats per selected case:

| Case                                      | Passed | Failed |
| ----------------------------------------- | -----: | -----: |
| Discovery recording                       |     12 |     18 |
| Held lazyEdgePanel Escape                 |     26 |      4 |
| Held EdgePanel Escape neighbour           |      0 |     30 |
| Other seven held-inspector variants, each |     30 |      0 |

Removing only the new recording readiness waits while retaining the controlled countdown fails **2/2** at the original `record-download` assertion (`tests/.output/g/rxw2UmC`). With the waits restored, the same six-worker/three-CPU load passes **30/30 discovery recordings plus 30/30 narration captures**, zero failures/flaky/skips (`tests/.output/g/rhy94iO`). A temporary Inspector diagnostic fails **2/2** with a journal showing Escape never reached the pending naming capture; the temporary diagnostic is removed.

```text
SUMMARY: 972aab1f8dff3cfabeb18fc52b7dc0eae43369e3 | unit="not run" parity="not run" e2e={"passed":60,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The initial health check at six workers/three CPUs passes its recovered-state assertions but times out during axe **4/4**. Its trace spends 18.2 wall seconds advancing 15 simulation seconds. This differs from the old missing-callout failure addressed in #308; neither assertions nor the whole-test backstop is changed to accommodate the overloaded run.

The unchanged health regression then passes **30/30 light plus 30/30 dark**, zero failures/flaky/skips, with six workers sharing six CPUs (`tests/.output/g/rNs0U6w`). The missing-callout failure does not recur; the state-based setup waits from #308 remain intact. The final health gate has the same exact SUMMARY line as the final recording gate above. Both gates run before the final signed commit, against the stated baseline plus the test-only working diff.
