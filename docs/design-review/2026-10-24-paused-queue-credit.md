## Conservative queue credit (PR #282 final round)

Engine-only review against the UX principles: pause/resume must preserve capacity accounting, so a
reply cannot make remaining represented waves disappear. Each queued request carries a pause flag;
the caller marks it when paused, and tracking stops when the callee begins its first service wave.
Any paused queue interval gets no credit, including its active portions. This deliberately conservative
rule keeps the pre-credit behavior for that request without an overlap tracker or new controls.

Joined processor coverage verifies positive queue credit, scale-one equivalence and unchanged caller
turnover relative to one identical branch. Summing the overlapping credits makes the regression fail.
