## Native browser failures during review-loop verification

The one full native gate on implementation commit `6ae268004da68d537848dc09aaaf163c461ed465`
passed static checks, unit coverage, build, size, parity and Docker checks, but reported four
Chromium failures:

- `html-export.spec.ts`: the encrypted Kafka export could not find the password toast at line 471.
- `join-resilience.spec.ts`: the lost-presence-frame join test exhausted its 90-second hang backstop.
- `latency.spec.ts`: the embedded scrolling case exceeded the context teardown backstop.
- `ux-resilience-followup.spec.ts`: the timeline roving-stop count at line 74 was 0 instead of 1.

```text
SUMMARY: 6ae268004da68d537848dc09aaaf163c461ed465 | unit={"passed":15373,"failed":0,"skipped":10} parity={"goldens":3146,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2177,"failed":4,"flaky":0,"skipped":4} gate_failures=1
```

A clean detached origin/master fixture at `2c6a463cb0f79dfd44c025c06aad486120ddacc9` installed frozen
dependencies, then ran only those four spec files, on the same native host with twelve workers:

```sh
pnpm gate quick tests/e2e/html-export.spec.ts tests/e2e/latency.spec.ts tests/e2e/join-resilience.spec.ts tests/e2e/ux-resilience-followup.spec.ts --only e2e --repeat 2 --workers 12 --max-wait 1
```

The first repetition passed all 32 cases. The second passed 31 and reproduced the same timeline
assertion: expected one roving stop, received zero. The other three failures did not recur in these
two isolated repetitions; they are not claimed to be individually confirmed baseline failures.
Application sources and browser spec files are byte-for-byte identical between the implementation
and that master baseline. The only changed source test is the review-loop unit test.

```text
SUMMARY: 2c6a463cb0f79dfd44c025c06aad486120ddacc9 | unit="not run" parity="not run" e2e={"passed":63,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Owner: Live Diagrams maintainers. Follow up on the reproduced timeline race and the three failures
seen under full native load. Preserve the assertions and output goldens. Per the bounded verification
rule, no full clean-master suite or additional full-suite retry was run; the remaining uncertainty is
recorded for PR CI rather than hidden by an assertion change.
