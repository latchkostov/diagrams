## Full-run browser observations during P2 queue triage

The single full native gate on docs-only commit `e010929b6d43eb7d117dbbf4b617445b289b8a92`
passed static checks, 10,278 unit/heavy cases, build/size, Docker deployment smoke and all
3,146 unchanged parity goldens. It failed two Chromium cases:

- `tests/e2e/ai-howto.spec.ts:60`, **with WebMCP / Copy example request copies a request naming a real node**:
  `callTool` at line 68 reported `No tool describe_diagram` before registration was available.
- `tests/e2e/checks-ui.spec.ts:315`, **typing a label does the same rendering work while checks run as with them held**:
  `finished()` in `tests/e2e/checks-typing.ts:162` timed out waiting for `pending` to become false
  during preparation, before a rendering-work comparison verdict.

No application implementation, test, configuration or generated asset differs from master
`7b6e905130a970fe6701422ee1408ce6c6058973`; this branch changes documentation only.
Neither failure is attributed to a proven product cause by this triage.

## Bounded clean-master comparison

A clean ordinary clone at that exact master SHA was created inside this checkout's ignored
`tests/.output/p2-master/`, with its own frozen dependency install. No other worktree was used.
Only the two failing specs ran, twice, with the same twelve-worker declaration, zero retries,
production E2E build and ports 6680–6684:

```sh
pnpm gate quick tests/e2e/ai-howto.spec.ts tests/e2e/checks-ui.spec.ts --only e2e --repeat 2 --workers 12 --max-wait 1 --ports 6680
```

Both repetitions passed all 22 cases each. This does **not** establish a reproduced pre-existing
failure on master. Keep these as unresolved full-run observations; do not mark either cause fixed,
relax an assertion or add a timeout/retry based on the isolated passes.

```text
SUMMARY: e010929b6d43eb7d117dbbf4b617445b289b8a92 | unit={"passed":10278,"failed":0,"skipped":5} parity={"goldens":3146,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2282,"failed":2,"flaky":0,"skipped":4} gate_failures=1
SUMMARY: 7b6e905130a970fe6701422ee1408ce6c6058973 | unit="not run" parity="not run" e2e={"passed":44,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Artifacts: `tests/.output/g/rvjyCdq/` and
`tests/.output/p2-master/tests/.output/g/rXJqpJX/`. The full gate's servers and Docker containers,
and the comparison gate's servers, were stopped by their owning gates. The first comparison
invocation stopped before building or running tests because port 6463 was already occupied;
the successful invocation used the separate 6680 range without touching that existing server.

## Follow-up and scope

Inspect the retained traces and registration/check-worker readiness under full-suite load before
choosing a fix. These two new verification observations are separate from the archived queue's
259 normalized items and do not change its disposition counts. The subsequent commit records
this evidence only. Per the verification budget, no second full suite or full clean-master gate
was run; the docs-only branch proceeds to PR CI with the red local full-gate result disclosed.
