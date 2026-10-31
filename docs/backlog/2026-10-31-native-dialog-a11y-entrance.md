## Wait for the existing dialog entrance before scanning its contrast

Nightly 41203890676, macOS shard 10, fails the syllabus reset-dialog scan at 4.47:1. The reported foreground `#d34147` is not the declared danger token `#d1393f`: the dialog and its backdrop are entering through `ix-rise` and `ix-fade` in `src/styles/interop.css`. The shared scan helper awaited `view-in` alone, leaving these two real opacity entrances unobserved.

Await the existing animation promises for all three entrance names. Keep every WCAG rule and the exact empty-violations assertion, and continue ignoring perpetual animations. The held-entrance regression now covers each name; restoring the old view-only filter must fail both dialog cases. No palette, animation duration, timeout or tolerance changes.

The target passes twice on native Windows. Both complete accessibility/syllabus specs pass 94 Linux executions across two repetitions; the target and geometry/focus neighbours pass 40 loaded executions across five repetitions at eight workers/four CPUs. All six units pass. An initial negative check was inconclusive because a single microtask hid an early scan; draining a real task boundary strengthens the regression. Restoring the old filter then fails both dialog cases (two failed/four passed), and the tested helper bytes are restored afterward.
