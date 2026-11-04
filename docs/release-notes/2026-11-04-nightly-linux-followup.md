## Linux Nightly follow-up

SVG export now clones the drawing while its first font download is in flight. It still waits for the complete font CSS before embedding and serializing the image. PNG keeps its previous scheduling. A held-font browser regression proves cloning proceeds during that download and compares every completed SVG byte with a subsequent capture, apart from generated pseudo-element IDs. The unit regression fails against the previous clone implementation.

The private-download regression now waits for each newly imported document before opening Properties. Its files retained `private: true`; the failing trace had accepted the previous import's identical toast and already-open Properties, then lost that panel when the new canvas mounted. All file, badge and library privacy assertions remain. The Checks tutorial regression waits for queued worker work to finish before reading its final observation.

The local gate accepts `--target dev` as well as `--target build`, including in its Linux container. A Dev run cannot produce a production verification stamp.

Each gate port also gets a separate Vite dependency-optimizer cache outside the shared installed-dependency volume. This prevents one Dev server's optimizer metadata from invalidating another's lazy-module URLs. A collaboration consent failure in the loaded run was an HTTP 504 `Outdated Optimize Dep` response for Yjs, not a missing consent transition. The cache-isolation regression fails against the previous configuration.

## Attribution and rejected changes

The export profile has the same dominant CSS reads/writes and serialization as `11839fab2`, before caching. In the loaded Linux Dev reproduction, first captures took 5.5–11.2 seconds while warm captures took 0.85–1.02 seconds. The whole-test deadline also includes two cold canvas loads and zoom setup. The retained change overlaps independent work; it changes no deadline or output contract. A complete-style cache gave no meaningful improvement and was removed.

The privacy and Checks observation races are in unchanged test/readiness paths, rather than a loss of privacy or a changed worker result introduced by Focus fit or cache loading. The complete P1 test body is identical in `11839fab2`, current master and this branch's previous HEAD. The current-master browser control was inconclusive because its archive served font URLs outside the archive root; it is not counted as a reproduction of the reported browser failures.

The partial-dot property has a pre-existing reporting-precision counterexample. Seed `-2078140383` fails identically before caching and twice on a clean source archive of current master, `e4a332cf7`, at the Nightly multiplier. Snapshot rounding in dots before conversion to requests produces `3.030001` versus `3.03`. The original Nightly seed is unavailable: the job reached its twenty-minute step limit before Vitest emitted failure details or its JSON artifact. See the dedicated backlog fragment for the discovered seed and shrink path.

No new simulation engine change is retained in this follow-up. Attempts to normalize counter precision changed existing exact allocation checks and output records, so they were rejected. No existing assertion or tolerance is weakened, no timeout increases, and no retry or quarantine is added.

## Output parity

This follow-up changes no golden. SVG/PNG bytes and simulation outputs retain their existing contracts. The earlier commit's documented Black Friday opening-camera golden remains its only intentional golden change.

## Verification

The final unit project passed 15,187 tests, retaining nine expected failures and ten existing skips. After adding cache isolation, all 66 affected regression tests passed. The affected heavy checks passed 317 tests, including all 35 startup/reserve checks; their existing expected failures/skips remain. The final engine digest suite passed all 288 checks across Chromium, Firefox and WebKit. Production build, size and regeneration/i18n checks passed. Full parity compared 3,342 goldens with zero changes, additions, missing or stale records.

The unchanged partial-dot file passed all twelve tests at multiplier 20 with the default CI seed `20261018`; the independently discovered seed above still fails on the branch and both attribution baselines. Exploratory precision prototypes failed existing exact checks and were removed before final verification. No simulation source change remains, so no final engine-change seed sweep is claimed.

The broad Linux Build and Dev gates each ran two repetitions. Every requested low-zoom export, private-download and Checks-worker case passed. The broad runs were not wholly green: Build had two additional PNG fallback timeouts; Dev had one stampede whole-test timeout and one separate collaboration-dialog failure. The PNG fallback replay passed all six tests. A later cold six-worker replay also hit whole-test deadlines; the backlog retains those results. After cache isolation and separating the controlled font boundary from the existing large Black Friday byte comparison, the final Dev replay at Nightly's three workers/four CPUs passed all fourteen cases across two repetitions (`r1kvYVr`). The new held-font SVG regression also passed both earlier Linux Build repetitions. See the additional load-failures backlog fragment; passing replays do not erase the original failures.

With the final configuration, the complete requested Linux subset passed both repetitions in each mode: Dev (`rfnGPcS`) and Build (`rgWnBuN`) each had 298 passed, zero failed/flaky and twenty existing skips. This includes all low-zoom, privacy, smoke, cache, stampede and showcase story/narration specs. The final scoped Build run also passed all sixteen cases, including the large Black Friday byte comparison and the final Lab held-font regression (`rUVvS5F`).

Exact earlier broad and final gate summaries (HEAD at the time of working-tree verification; the last line applies to both final complete modes):

```text
SUMMARY: e9d5e8b670a57209f28a02e4ec532d26804fc759 | unit="not run" parity="not run" e2e={"passed":404,"failed":2,"flaky":0,"skipped":20} gate_failures=1
SUMMARY: e9d5e8b670a57209f28a02e4ec532d26804fc759 | unit="not run" parity="not run" e2e={"passed":406,"failed":2,"flaky":0,"skipped":20} gate_failures=2
SUMMARY: e9d5e8b670a57209f28a02e4ec532d26804fc759 | unit="not run" parity="not run" e2e={"passed":14,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: e9d5e8b670a57209f28a02e4ec532d26804fc759 | unit="not run" parity="not run" e2e={"passed":298,"failed":0,"flaky":0,"skipped":20} gate_failures=0
```
