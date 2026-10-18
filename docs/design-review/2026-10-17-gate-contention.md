## Gate contention developer experience review

The default path is quick checks, targeted regressions and PR CI. Expensive complete local verification
is available explicitly, with a bounded wait for agents. Waiting explains who holds capacity and how
long they have held it, then gives an actionable busy message with a distinct exit code.

FIFO trades occasional unused capacity for a guarantee that a full run eventually starts. JSON files
are diagnostic sidecars to OS sockets, so contributors never need to delete a stale lock manually.
No editor controls, canvas layout, simulation behavior or public examples change. The chrome budget
and interaction contracts are unaffected. Remote same-job browser comparisons remove local contention
from performance measurements while preserving explicit filters, modes and CPU throttles.

## Contention demo

Two actual quick commands used two workers each, on separate port ranges. The second finished its
typecheck while the first continued through lint, typecheck, formatting, i18n, skill and related units:

```text
pnpm gate quick --workers 2 --max-wait 1 --ports 6660
Gate budget: 2/12 workers/CPUs; 2 test workers
pnpm gate quick --workers 2 --max-wait 1 --only typecheck --ports 6665
Gate budget: 2/12 workers/CPUs; 2 test workers
PASS: typecheck (3.5s)
```

A default full request waited for the whole budget. The bounded-wait replay held two slots with a
parity quick run, printed its holder every 15 seconds, and exited after one minute:

```text
pnpm gate full --max-wait 1 --ports 6670
Waiting for gate budget (2/12 workers/CPUs in use):
  running: <worktree> | test/gate-contention | pnpm gate quick --workers 2 --only parity --max-wait 1 --ports 6675 | PID 21168 | 2 workers/CPUs | started 2026-10-18T03:36:43.666Z | elapsed 47s
... refreshed at elapsed 62s, 78s and 93s ...
gate: busy: push and let CI run the full gate, or retry later
DEMO_EXIT=75
```

A later small smoke run waited behind that full request despite free capacity, then proceeded once
the full request timed out. This demonstrates the deliberate FIFO tradeoff as well as unit coverage
of release on process death and eventual full admission. Twelve is the demo's derived budget, not a
fixed contributor requirement. The busy result is expected; no complete local full gate was run.
