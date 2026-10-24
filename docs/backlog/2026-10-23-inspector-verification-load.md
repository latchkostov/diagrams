## Option H verification under shared load (#265)

The broad native unit run was stopped after timeout failures while another worktree held all twelve shared gate slots. No assertions, test backstops or bundle budgets were changed. The run is incomplete and has no passing full-suite summary.

A clean archive of origin/master d8850ec5, inside this worktree's ignored output directory, reproduced the two scalingPlanner refined-peak timeouts, retry-storm evidence, A3 seeds 24 and 62, requestsReadiness's partition-adding alternative and the deterministic skill ZIP test timeout. Its focused summaries were `Test Files 3 failed | 3 passed (6); Tests 5 failed | 40 passed | 449 skipped (494)` and `Test Files 2 failed | 2 passed (4); Tests 2 failed | 79 passed | 201 skipped (282)`; all type checks passed. These are targeted native results, not a clean-master full-gate SUMMARY.

The four collaboration knock cases and two scale-equivalence cases passed the clean-master replay (`4 passed` files, `90 passed | 163 skipped` tests). On the implementation's isolated replay, five of those six cases passed; cpuPool at scale 1.1 still reached its unchanged five-second backstop. Do not label that case a proven pre-existing failure. Option H's new unit regressions passed in the same replay. Existing master fragments also track simulation backstops and ZIP build cost.

Inspector/a11y Linux repetition admissions, including the neighbour suite at six workers/six CPUs and repeat five, returned busy (75). No E2E SUMMARY was produced by those attempts. Preserve the assertions and use PR CI for the unavailable Linux coverage.

## First full Linux run

`SUMMARY: f0862e7fe302e8c35433572afcf66ead8cc0704b | unit={"passed":15329,"failed":0,"skipped":10} parity={"goldens":3146,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2213,"failed":4,"flaky":0,"skipped":0} gate_failures=2`

Three browser failures described the previous design: the narrow paired-field gap is 16 px (10 px only in the wide ledger), connection dividers use the approved 70% line-token mix, and collapsed header text now includes its summary while its accessible name remains the title. Exact assertions now cover those approved outputs.

The fourth exposed a real saved-simulation keyboard-focus regression. The live controller published its new definition while the editor getter still returned old metadata; the transient draft classification removed the fields. Immediate metadata reads fix the gap without a focus workaround or relaxed assertion. The new unit regression fails without that fix, and the focused browser case retains the same radio DOM node and Off focus.

After the corrections, all 56 cases in inspector-layout, planning-p1, resilience-breaker and ux-resilience-followup passed against a production E2E build with four native Chromium workers and zero retries. Related editor unit verification passed 219 checks. Final parity retained all 3,146 goldens unchanged. The post-fix Linux five-repeat admission again returned busy (75) while another worktree held all twelve slots; no repetition SUMMARY was produced.
