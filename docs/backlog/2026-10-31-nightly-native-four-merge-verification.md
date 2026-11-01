## Merge resolution audit

Merge base: `f843d13ac`; incoming master: `f60003c89`; previous branch head: `a69afe2fe`.
Master's entire `play()` body is identical to both the merge-base version and the shared helper.
This includes `history`, `importFixture`, `open`, rendered-edge path clicks, lazy Live entry,
`modClick` and `rightclick`. No master-side changes to those branches were missing.
The conflicting change belongs to `finishSolution()`: port its Highlights-off `tutorial-spot`
assertion into `pointer-tutorial-driver.ts`, keeping the extraction and shared imports.

The remaining changes in `tutorials.spec.ts` retain master's keycap assertions, `coach-card`
geometry selector and `tutorial-spot` checks. `tutorials-runtime.spec.ts` and the new coach spec
match master exactly, including dock-adjacent RTL placement and compact phone-sheet assertions.
No test expectation, timeout, skip or bundle reserve is relaxed.

## Capacity follow-up

Both the pre-fix Highlights-off regression attempt and the final targeted Linux gate exited
75 at admission because another live gate held all 12 worker/CPU slots. No lock was changed,
no server was started, and no test executed in either attempt. The final requested cohort contains
`tutorials.spec.ts`, every keyboard partition (this checkout has four spec files), runtime,
syllabus and coach specs, every tutorial unit, startup/reserve and stencil-asset heavy tests,
production build, size and full parity. These checks, plus the browser regression reversion,
remain for PR CI under the authorized busy-gate push exception. No full suite was queued.

`pnpm regen` passes without further generated-file changes; i18n validation reports zero errors
with existing missing/stale translation warnings. No golden was re-recorded.
