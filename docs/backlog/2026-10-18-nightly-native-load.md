## Native Windows loading and teardown failures

Nightly 39115946465 on cf252ceb reported seven failures still unresolved after two
Linux reproduction rounds at 3 CPUs, 7 GB and three workers. The corresponding
tests passed both rounds. Per the triage velocity rule, these exact cases use
Windows-only `test.fixme`; Linux and macOS coverage remains enabled.

| Test at the Nightly revision      | Evidence                                                                                                               | Next investigation                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `followups4-inspector.spec.ts:58` | `live-controls` absent; the LiveSession request took 10.17 s and simulation 9.75 s.                                    | Profile the native preview server and competing idle preloads on a small Windows runner. |
| `live.spec.ts:91`                 | Controls absent while simulation and Live dependencies were downloading.                                               | Same cold-load investigation, retaining the current assertions.                          |
| `live.spec.ts:129`                | Hover stays at Loading throughput explanation; planning UI request took 6.51 s with other dependencies still arriving. | Separate native filesystem/network serving from module evaluation and planning.          |
| `slowmo.spec.ts:65`               | Test and context teardown each exceeded their existing 30 s backstop; trace is incomplete.                             | Capture browser process diagnostics before teardown stalls.                              |
| `slowmo.spec.ts:108`              | Trace reaches the final disabled-control assertions, then context close stalls.                                        | Same teardown investigation; keep every engine-mutation assertion.                       |
| `slowmo.spec.ts:271`, fitted only | Trace reaches viewport restoration assertions, then context close stalls.                                              | Same teardown investigation; the manually zoomed case stays enabled.                     |
| `slowmo.spec.ts:297`              | Trace reaches the recording option assertions, then context close stalls.                                              | Same teardown investigation.                                                             |

The long requests support a load classification, but do not establish whether
the cause is native serving, module evaluation or idle preload contention.
No assertion, timeout or retry count was relaxed. Remove each `fixme` only with a
native reproduction, a causal fix and repeated small-runner validation. This
entry does not cover `slowmo.spec.ts:135`, owned by the separate follow-up branch.
