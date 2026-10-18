## Paused slow-motion follow camera moves after Inspector resize

The Windows Chromium production-build run of `followups4-inspector.spec.ts` fails
`Inspector resize leaves a paused slow-motion camera unchanged (follow)` at its exact viewport
comparison (line 476). The transform changes from
`translate(13.4702px, 342.392px) scale(0.798833)` to
`translate(11.4799px, 342.237px) scale(0.799773)` after resizing the Inspector.

This reproduces identically on clean `origin/master` at
`45b689772c275d58eaa7d1b7b11bc586520f2522`, checked out temporarily in the same worktree with the
readiness fix stashed. Five repetitions of both paused-camera variants report **5 failed, 5 passed**:
every follow variant fails and every fit variant passes. The branch's once-only run of `live.spec.ts`
and `followups4-inspector.spec.ts` reports **1 failed, 57 passed**, with the same assertion and values.

Reproduce against a production build with the five explicit E2E ports 6960–6964, `E2E_CHROMIUM_ONLY=1`
and `E2E_GATE=1`:

```text
pnpm exec playwright test tests/e2e/followups4-inspector.spec.ts --project=chromium --workers=2 --grep "paused slow-motion camera unchanged" --repeat-each=5
```

Investigate the paused follow camera's settling and resize lifecycle separately. Keep the exact
no-movement assertion; do not loosen it or add an elapsed-time wait. The standalone Live readiness
fix does not affect the editor host's existing session callback wiring.
