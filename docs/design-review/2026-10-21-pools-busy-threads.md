## Chrome and terminology

The pool stays in the connection's existing Advanced disclosure, with the same
**Connection pool** label in both modes. Reply handling remains non-blocking only.
The hint explains held-thread queueing and the memory cost of either mode.
No toolbar, canvas menu or global control is added.

The existing autoscaling metric selector gains **Busy threads (modelled custom
metric)**. Its Advanced target-unit selector distinguishes percent of Concurrency
from threads per pod. KEDA can add this metric beside its separate broker target;
ECS explains why it cannot. Legacy revisions cannot choose or persist the metric.

## Interaction and accessibility

Inputs retain existing labelled fields, keyboard operation, undo and persistence.
New selects have data-testid hooks and associated labels. Production browser
regressions cover both pool modes, both HPA target units, KEDA's separate target
and the planner's wording. The planner reads constant-time thread counters instead
of constructing frames or scanning held calls. No endpoint or CSP change is needed.
Inspector rendering uses a model capability from existing metadata instead of
copying the diagram to decide whether to offer the metric.

## Lessons and scope

Both lessons are public gallery entries with the existing Requests that wait tag;
the scaling lesson also has Autoscaling. Their explicit small sampling factors
keep the demonstration away from the known sampled-pool accuracy gaps. The
scaling lesson states its accelerated controller timings and ten-pod maximum;
the pool lesson makes gateway failures visible instead of claiming that a pool
alone frees blocking threads.

The planner's verified metric fix leaves the initial four-pod capacity estimate
intact. Checks can still show that static warning after the scenario sizing advice
has cleared; reconciling that estimate with a verified dynamic fleet belongs to
the next Checks stage. Existing assertions about older fixes remain unchanged.

## Rejected changes

No second pool queue, new node concurrency setting, lower CPU target for a waiting
majority, ECS custom metric implementation, legacy-output update, bundle split or
plugin version bump is included.
