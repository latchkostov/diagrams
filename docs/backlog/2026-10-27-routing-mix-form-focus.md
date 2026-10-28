## Traffic mix form intermittently fails to open on clean master

The PR #371 reserve fix reproduces the routing CI failure on clean origin/master
`aa6a4090b9a0e6e6c65c67bb5eeaeabac95976d7`, checked out in the same worktree with no edits.
Node 24.22.0, the production E2E build, Chromium, three workers and five repetitions report
**1 failed, 4 passed** for `tests/e2e/routing.spec.ts:201`, "asking for a traffic mix again
opens the new route's form again".

The failure is at line 207, the first `toBeFocused` assertion: `mix-new-route-path` is missing
after invoking Add traffic mix from the node menu. This matches the reported CI assertion
signature. The earlier five-run check on clean master `6dd721901` passed, illustrating why
one successful batch does not establish that the race is fixed.

The branch's initial focused five-run batch and its two full routing-spec repetitions pass.
The reserve fix does not change routing, focus assertions or timeouts. Investigate the
menu-to-inspector intent handoff separately.

Local evidence: `tests/.output/live-trim-routing-master-final.log`; the retained screenshot,
error context and trace are under `tests/.output/live-trim-master-routing-results/`.
