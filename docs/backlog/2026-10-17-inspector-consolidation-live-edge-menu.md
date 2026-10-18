## Live edge-label naming can fail with a message-trace card open

The Inspector consolidation's targeted Linux gate and a clean origin/master checkout both fail
`tests/e2e/text-fields.spec.ts:523`, "live keyboard and menu naming select all of edge-label-ab".
Both runs execute the same 355 cases with four workers, fresh production/test-hook builds, zero
retries and ports 6700–6704. Both finish with 354 passed, one failed, zero flaky and zero skipped.

| Checkout                                                     | Observed failure                                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refactor b062804374bd01c19b37196afea006148454c99d            | The right-click completes; line 542 times out waiting for `context-menu-item-edge.edit-label`. The failure screenshot contains an open message-trace card beside the edge label. |
| Clean origin/master b13d4ccfc1f98dac891bca99ebb9537a0b7830ed | Line 541 times out right-clicking `edge-label-ab`. Playwright explicitly reports that `trace-card` intercepts pointer events.                                                    |

The same test fails, but the timeout points differ. The snapshots and pointer logs suggest that
live particle tracing interferes with opening the edge menu; the exact event ordering still needs
investigation. Do not describe this as an identical assertion failure or fix it by loosening an
assertion, adding a delay or forcing a click.

The master comparison used `git switch --detach origin/master` in the task's existing worktree,
with a clean tracked tree, followed by the same command below. The refactor branch was restored
afterward. No other worktree, test expectation, product behavior or golden was changed for proof.

```powershell
pnpm gate quick tests/e2e/inspector.spec.ts tests/e2e/inspector-resize.spec.ts tests/e2e/followups4-inspector.spec.ts tests/e2e/relationships.spec.ts tests/e2e/routing.spec.ts tests/e2e/planning-p1.spec.ts tests/e2e/planning-p2.spec.ts tests/e2e/planning-p3.spec.ts tests/e2e/zones-boundaries.spec.ts tests/e2e/i18n.spec.ts tests/e2e/i18n-static.spec.ts tests/e2e/editor.spec.ts tests/e2e/text-fields.spec.ts --only e2e --linux --workers 4 --ports 6700
```

Local reports: `tests/.output/g/rkYqomB/` (refactor) and `tests/.output/g/rHAYyHV/` (master), including
JSON, screenshots, traces and step logs. The initial gate attempt stopped before any test because
the default temporary drive had less than 8 GiB free. Setting this run's TEMP/TMP to the ignored
`tests/.output/inspector-temp` directory on the workspace drive resolved that preflight failure.

Keep the consolidation unpushed under the task's failure rule. Resolve this interaction separately,
then rerun the requested checks and targeted gate before pushing.
