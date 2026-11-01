## SVG export: no qualifying speedup

Investigation on `perf/svg-export-1`, based on `b164fffa7`. The acceptance rule is
more than 15% faster with byte-identical SVG/HTML and unchanged parity goldens.
No production implementation is retained or proposed for shipping.

The round-six verification fragment was absent in this checkout and fetched
`origin/master` at the start. During the investigation origin advanced to
`f302070c6` (#415); its fragment was then read directly from the Git object without
changing this branch. It confirms the CSS/serialization hotspots and rejects
alternate native reads, inconsistent batched reads, reordered mutable templates,
inconsistent full-value clone reuse and scheduler/sequential scheduling changes.
[The earlier low-zoom investigation](2026-10-31-native-lowzoom-export-work.md)
provides additional rejected-cache evidence. PNG's #389 path is separate.

### Method and artifacts

Windows, Node 24.22.0, Chromium 156.0.8078.4, production E2E builds, one benchmark
worker, 1440 × 900, device scale one, 2× main-thread CPU throttle. Each timing cell
uses three fresh browser contexts. The deterministic pipeline workloads have
500/1,500 nodes; their generated JSON hashes remain identical across prototypes.
The third workload is the public Black Friday example. Timings run from the SVG
export button to completed download, after the canvas settles; setup is excluded.
The exports are approximately 62.79 MB, 187.89 MB and 9.28 MB respectively.

The opt-in harness is `tests/bench/ui/svg-export.bench.ts` (`SVG_BENCH=1`,
`SVG_LABEL=<variant>`, `BENCH_PORT=6620`). Run `pnpm bench:prepare` for sizes
500/1500 and `node scripts/bench/build.mjs` first. `SVG_TRACE=1` separately selects
the named build, native-call instrumentation, a CPU profile and a DevTools trace.
Instrumented diagnostic times are not mixed into the uninstrumented samples.

Local evidence is in `tests/.output/bench/svg-export/{before,inheritance,deferred,stream}/`:
JSON samples, downloaded SVGs, `.cpuprofile` files and `.trace.json` files. Supporting
logs and analysis scripts are in `tests/.output/svg-*`. No committed baseline or
golden is re-recorded. Separate browser contexts can enumerate custom properties
in different orders, so cross-context file hashes alone are not a byte-identity
test; comparisons use the same stationary DOM and canonicalize generated pseudo
IDs only.

### Uninstrumented export times

Median (range), seconds:

| Workload       | Original               | Inherited-value cache  | DOM declaration deferral | Serializer injection   |
| -------------- | ---------------------- | ---------------------- | ------------------------ | ---------------------- |
| Pipeline 500   | 13.347 (13.236–13.595) | 12.947 (12.917–12.985) | 14.831 (14.798–14.841)   | 14.479 (14.144–14.719) |
| Pipeline 1,500 | 35.950 (35.898–36.066) | 35.762 (35.455–35.807) | 40.509 (40.415–40.795)   | 39.556 (38.967–39.985) |
| Black Friday   | 2.206 (2.173–2.425)    | 2.209 (2.128–2.248)    | 2.381 (2.347–2.394)      | 2.252 (2.245–2.423)    |

Inherited-value caching gains only 3.0% / 0.5% / −0.1%; it does not meet the bar.
DOM declaration deferral regresses 11.1% / 12.7% / 7.9% and fails exact comparisons.
Serializer injection regresses 8.5% / 10.0% / 2.1%.

### Profile and trace

Native-call elapsed time from the diagnostic run, seconds (instrumentation adds
overhead, so these are diagnostic observations rather than an additive breakdown
of the uninstrumented export):

| Workload       | Computed-style lookup | Declaration reads | Declaration writes | Native clone | XML serialization |
| -------------- | --------------------- | ----------------- | ------------------ | ------------ | ----------------- |
| Pipeline 500   | 0.056                 | 4.502             | 5.473              | 0.091        | 1.701             |
| Pipeline 1,500 | 0.156                 | 13.668            | 16.552             | 0.262        | 5.161             |
| Black Friday   | 0.008                 | 0.673             | 0.823              | 0.014        | 0.252             |

CPU sampling separately attributes 11 / 36 / 7 ms of self time to the image/font
inlining helpers at 500 / 1,500 / Black Friday. String assembly and serializer
bookkeeping (`serializeChildren`, `serializeInContext`, slicing/joining) account
for 258 / 751 / 36 ms of sampled self time, excluding native XML serialization.
The principal costs remain per-property CSS reads/writes, followed by native XML
serialization (including CSSOM's lazy style text serialization).

### Rejected approaches

- A detached stylesheet declaration target is slower in a separate native-CSSOM
  microbenchmark: about 188 ms versus 121 ms for 1,000 blocks. It is not promoted
  into the exporter.
- A bulk parser prototype is no faster and changes native declaration order,
  including logical/physical width/height ordering. It is rejected before shipping.
- The inherited-value cache inspects stylesheet and inline declarations,
  conservatively excludes overrides and unknown scopes, and reuses only inherited
  custom properties. Its measured gain is insufficient to justify that complexity.
- DOM declaration deferral caches native custom-declaration text by exact
  `(property, computed value)` and appends new declarations after embedding. It
  reduces native writes but reparses styles and changes bytes; the three timing
  workloads all regress.
- The final serializer prototype instead injects the cached native XML-escaped
  declarations into serialized tags, removing temporary attributes. It avoids
  reparsing but still regresses on every workload. It also changes image
  attribute order on the two branch-to-datacentre cases.

### Verification and disposition

The original exporter is the reference for the owner contract. The serializer
prototype passed six of eight image-golden cases against upstream `html-to-image`,
and also six of eight against the original exporter copied from `b164fffa7` into
the ignored output directory. Both branch-to-datacentre themes fail on image
attribute order (`srcset` relative to `style`). Restoring the original exporter
makes the light branch control byte-identical, confirming a prototype regression.
No attribute/declaration sorting is permitted in these comparisons.

An initial numeric trace attempt failed before loading either workload because
editing the source changed the workload cache key. After materializing the same
JSON again, both numeric trace cases passed. The deliberate native-write control
on the restored exporter was byte-identical and failed the new operation-count
assertion, as intended (150,500 writes versus 120,781 with serializer injection
on the light pipeline fixture).

After restoring production code, the original low-zoom test was run three times
in parallel in the pinned Linux container, with three workers and two CPUs:

```sh
pnpm gate quick tests/e2e/lowzoom-chips.spec.ts:229 --linux --only e2e --repeat-each 3 --workers 3 --cpus 2 --ports 6680 --max-wait 1
```

All three fail with the original whole-test deadline. This is a baseline
reproduction, not a verified repair. The exporter and this test have no diff
between the measured baseline and the newer `origin/master`. No deadline changes
or retries are used. The gate owns and removes its servers/container.

```text
SUMMARY: b164fffa72ba41ee1eae75c0f7c52c163100c645 | unit="not run" parity="not run" e2e={"passed":0,"failed":3,"flaky":0,"skipped":0} gate_failures=1
```

The report is `tests/.output/g/r95F4pQ/summary.json`; its E2E logs and traces retain
the failures. The original exporter and all existing tests are restored. Only
this research fragment and the opt-in measurement harness remain uncommitted;
the rejected serializer and byte-comparison probe are retained under the ignored
`tests/.output/` directory.

There is no qualifying implementation to commit, push or open a PR for. Full
parity, the complete export gate, reserve/size checks and the full local gate are
not acceptance claims for these rejected prototypes. Goldens, deadlines,
tolerances, budgets and the original low-zoom test are unchanged.
