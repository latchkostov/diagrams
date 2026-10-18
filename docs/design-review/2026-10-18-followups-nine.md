## Startup and composer boundaries

No control, menu item or UI text is added. The Live toggle's busy state describes
the actual requested session's lifecycle; pressing it still turns Live off while
its code downloads. Readiness waits observe DOM changes, with no sleep, retry or
new timeout. The hover uses its existing explanation marker.

The AI draft reset regression fills both Advanced fields with a valid, unapplied
change, switches through the picker without a reload, and checks empty fields
and disabled Apply. The existing save-as-copy regression continues to cover
preserving the draft within the same mounted editor.

## Measurement boundary

The old blocks had unequal state: after the first held key, findings stayed stale;
each running key started fresh. Clearing staleness changes the Inspector's
rendering work. The comparison now types the same character into the same prefix
in 21 adjacent pairs, starting both with fresh findings. The Inspector publishes
its existing stale state in a data attribute. Removing preparation deterministically
fails the new fresh-findings assertion (`true` instead of `false`).

The real checks worker's replies are queued at its message event until Chrome's
CPU reading has been taken. The engine, document copy and postMessage still run
inside the sample; result publication happens afterwards in both modes. This
removes the race between a fast reply and the two paint callbacks. The 1,500-node
workload, same-page paired baselines, required run count and 1.5 ratio stay
intact. Worker failures still reach the real fallback.

Removing only reply queuing did not reproduce publication inside samples on the
fast native host, including at 4× main-thread throttle. It is a controlled sample
boundary, rather than evidence that those replies caused the original Nightly
failure. The unequal stale/fresh setup is independently reproduced above.

## Rejected changes

No retries, larger timeouts, looser ratios, transform tolerances or output golden
updates are used. Broad preloads would add contention without establishing its
cause. The four slow-motion cases do not start capture; changing recorder or
playback ownership without a reproduction would not establish a teardown fix.

The separate paused-follow camera failure reproduces twice on clean master;
its exact assertion remains enabled and its evidence is in a dedicated backlog
fragment.

## Native qualification and quarantine decisions

Locations below are the original #164 inventory. The final native run uses four
logical CPUs (`0xf` process affinity), three browser workers and two competing CPU
processes, with no retries. Five repetitions pass **115 cases, zero failed,
zero flaky and zero skipped** (`tests/.output/g/rsTrNzD/`). The checks CPU ratios
are **1.008, 0.996, 0.970, 1.016 and 1.044**, against the unchanged 1.5 limit;
all 21 running samples per repetition run checks, with zero publications inside
the CPU samples. Forcing the engine onto the main thread with a worker still
alive fails at **4.59×** (`tests/.output/g/rZTX5fi/`).

| #164 test                 | Cause and change                                                                                                                                          | Quarantine                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `followups4-inspector:58` | A controls assertion raced the session download. Observe Live's actual mounted-session busy state first.                                                  | Lifted after five native passes. |
| `live:91`                 | Same session readiness boundary; controls assertions keep their original timeout.                                                                         | Lifted after five native passes. |
| `live:129`                | The hover exists before its planning code. Observe `planning-observed`, shared by configured and unavailable-analysis views.                              | Lifted after five native passes. |
| `checks-ui:313`           | Held blocks stayed stale while running keys began fresh. Compare adjacent identical key/prefix pairs with fresh findings, and control the reply boundary. | Lifted after five native passes. |
| `slowmo:65`               | No native close stall reproduced; no causal cleanup change established.                                                                                   | Retained.                        |
| `slowmo:108`              | Same unresolved native close stall.                                                                                                                       | Retained.                        |
| `slowmo:271`, fitted      | Same unresolved native close stall; exact camera assertions remain.                                                                                       | Retained.                        |
| `slowmo:297`              | Same unresolved native close stall; this case opens options but starts no recording.                                                                      | Retained.                        |

The first native investigation also passed all slow-motion cases with neighbours
five times: **305 passed, zero failed or flaky** (`tests/.output/g/r8XXfet/`, one
competing CPU process). The second round's temporary probe observes all 20 target
contexts closing every created worker and leaving zero outstanding requests.
The probe is removed; the four Windows-only skips are restored. Passing ten times
per target without reproducing a stall does not establish a fix. The active
[native backlog](../backlog/2026-10-18-nightly-native-load.md) records the evidence
and the remaining diagnostic boundary.

The first iteration used a configured-explanation marker that the unavailable
analysis hover never renders. That native probe caught the mistake with a whole-test
timeout; it was stopped and corrected to the shared observed-throughput marker
before the five successful repetitions. The separate paused-follow camera failure
also reproduces twice on updated clean master `45b68977` (52 passed, two failed,
two skipped); both clean-master summaries are preserved in the
[camera backlog](../backlog/2026-10-18-paused-follow-camera.md).

The gate CLI accepts spec filters in `quick` mode, so focused native runs use
`quick --only e2e`; it invokes the same production E2E runner. The complete gate
runs after the final signed commit.

## Linux load and unit verification

Five complete Linux repetitions at three CPUs, 7 GB and four browser workers pass
all 195 cases each: **975 passed, zero failed, zero flaky and zero skipped**
(`tests/.output/g/r7x1CEG/`). The affected specs and every annotation, drawing-basics,
round4-polish, viewport, platform and Inspector neighbour are included. The checks
ratios are **0.971, 0.929, 1.005, 0.950 and 0.975**, with 21 running samples and
zero publications inside samples in every repetition. All exact camera assertions
pass on Linux; the separately recorded native camera failure remains enabled.

The complete native unit suite with four workers and seed `20261018` passes
**10,635 tests, four skipped**, across 700 files, with zero type errors. The
production build passes, and its entry is **107.1 kB gzip against 123.5 kB**.
Regeneration refreshes the committed viewer for the Live busy attribute without
changing a plugin version or English messages. The deliberate identity and busy
mutations fail their regressions, and removing fresh-pair preparation fails its
state assertion. All temporary mutations and the native resource probe are removed.

Complete output parity passes **2,196 goldens**, with zero changed, added, missing
or stale (`tests/.output/g/rTshbZO/`). No golden is re-recorded.

## Full gate findings

The first post-commit full Linux gate passes all static checks, 10,635 unit
tests, the build, size and all 2,196 unchanged goldens. Browser results are
**1,592 passed, two failed, zero flaky** (`tests/.output/g/r1Jgpn5/`). One failure
is the paused-follow camera assertion above. Five clean-master Linux repetitions
reproduce it three times, with **137 passed, three failed, zero flaky**, and no
other failure (`tests/.output/g/rgKIM0I/`). The exact summary is in its backlog.

The other failure is the checks measurement's setup boundary. Its trace shows
equal started/finished counts, followed by a delayed setup run starting before
the first sample. Holding that reply leaves the sample's next run queued behind
it, so no run comes due. The existing scheduler already knows about debounce,
idle and active work; its busy state is now exposed through the E2E stats hook
and used for preparation. A fake-clock regression covers all three phases and
cancellation. Substituting the old counter comparison makes it fail before any
run starts. No timeout is changed.

## Readiness requalification

The revised measurement, all three cold-load cases and the complete AI and
Checks UI specs pass five native repetitions: **150 passed, zero failed, zero
flaky, zero skipped** (`tests/.output/g/rrp8hdE/`). This uses the same four logical
CPUs, three workers and two competing CPU processes. Ratios are **0.953, 1.029,
0.993, 0.956 and 0.963**; every repetition measures 21 running checks and zero
result publications inside samples. Both competing processes stop afterwards.

The complete revised native unit suite passes **10,637 tests, four skipped**
across 700 files, with no type errors and seed `20261018`. Regeneration and the
production build pass; entry size remains **107.1 kB gzip against 123.5 kB**.
The additional readiness hook produces no further generated viewer change.

Five Linux repetitions of all affected specs and the complete UI neighbour set
pass again after the pending-state correction: **975 passed, zero failed, zero
flaky, zero skipped** (`tests/.output/g/rD6oESz/`). The limits remain three CPUs,
7 GB and four browser workers. Every exact camera assertion passes in these
repetitions; the separately reproduced master failure stays enabled.
Typing ratios are **0.978, 0.970, 0.991, 0.979 and 0.968**, with 21 measured
running checks and zero publications inside samples in every repetition.

Pre-commit parity passes again on the complete revised change: **2,196 goldens**,
zero changed, added, missing or stale (`tests/.output/g/ro34caU/`).
