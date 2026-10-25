## Unit verification under concurrent build work

The native Live trim verification ran the full suite with one worker while viewer
generation and build checks were also running. Four existing five-second test backstops
expired: scalingPlanner's refined Capacity peak, examples' retry-storm evidence, and two
bundleBase install/cache fixtures. All four pass targeted reruns without assertion or
timeout changes. The two simulation cases also passed twice on clean master. An archived
master run of bundleBase encountered Windows ENAMETOOLONG instead, so that archive is
not evidence of the original timeout reproducing on master.

Keep generation sequential with tests that read the committed viewer: two HTML equality/CSP
cases observed different generated revisions in the same run and pass after regeneration.
Investigate the four backstops in an admitted gate before changing test structure; do not
raise their budgets, quarantine them, or call the observed timeouts deterministic failures.
This records the verification limitation; the trim's own targeted regressions pass.
