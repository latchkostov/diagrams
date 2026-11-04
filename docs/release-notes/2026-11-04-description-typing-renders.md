## Restore the Inspector typing render budget

Memoize the Description disclosure around its existing stable editor child so label and subtitle edits
do not reconcile the unchanged disclosure. Description edits still update its title, and typing or
clearing text preserves the user's open/closed choice. The typing regression now opens the collapsed
empty Description before editing it; its render and commit budgets are unchanged.

Keep the hot disclosure and field's native markup inline, matching the existing label field's approach,
so editing the description also stays within its original render budget without changing the DOM.

The typing spec's production React hook measured these median function-component renders per label
key (six keys per variant):

| Variant   | Master (`641c94ec5`) | Before | After |
| --------- | -------------------- | ------ | ----- |
| Plain     | 14                   | 16     | 14    |
| KEDA      | 14                   | 16     | 14    |
| ECS/ALB   | 14                   | 16     | 14    |
| ACA event | 14                   | 16     | 14    |

The extra work was `Description` and its `ReadoutDisclosure` child, each rendering once per key with
unchanged props. Output parity passes all 3,342 goldens unchanged; none were re-recorded.

The opened description cases initially exposed 17 renders per key. Inlining the wrappers restores
15 for both plain and KEDA descriptions; subtitles use 13. All existing budgets remain unchanged.
