## Follow-ups 4 integration with master

The branch is rebased onto the portable gate in #147. Zoom to selection retains master's measured
refinement and suppression of the deferred Inspector reveal, while claiming manual camera ownership.
Whole-diagram fits claim fit ownership. Deferred work checks both its measurement epoch and its current
ownership claim, so pane changes follow the latest fit, manual view or narration.
The dock handler also defers its pane adjustment while a context menu is open and lets Shift+2's
measured refinement finish without an intervening selection pan.
The former Inspector-only reveal is folded into that same handler: two overlapping pans could retain
the first animation's temporary zoom when the Inspector reopened.

The collaboration browser test keeps both the production/dev network checks and the branch's diagram-fit
helper. Generated artifacts were refreshed by sync, and all replayed commits remain GPG-signed.

No parity goldens were changed by this integration. The branch's existing intentional changes remain:
the 27 layout goldens change only `tidy.viewport` to account for the Inspector pane, with the additional
`shared-worker-pool.json` correction settling the Inspector before Tidy; `node/i18n/catalogs.json` records
the new messages, translations and fallbacks. Every affected file and its reason is documented in
[the original release note](2026-10-17-followups-4.md).

## Regression evidence

The first focused run passed 50 browser cases and failed the Arabic rapid quick-add and deferred
Inspector zoom cases. The new dock guards fixed both: all 52 cases passed with zero failures or flaky
cases. The zoom case additionally checks that closing and reopening the Inspector preserves 125% zoom.
That extension caught the overlapping reveal pans before consolidation.
Temporarily restoring the separate reveal reproduces a final zoom of 0.734 instead of 1.25; temporarily
removing the dock guards reproduces the original two failures. Treating the selection fit as whole-diagram
ownership also fails the platform regression. Each temporary change was restored.
Ownership tests reject replacing claim identity with owner-name equality, which would revive an old
fit after a later fit takes ownership. Camera and geometry units passed before that negative control;
the original implementation was restored afterward. The final camera/geometry run passes all 103 tests
with no type errors, and the final focused production run passes all 52 browser cases with zero flaky cases.
