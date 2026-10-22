## Inspect findings omitted by the whole-diagram budget

Deferred from #230's final delta review. The Inspector currently reads the bounded whole-diagram
result, so a later target can have findings omitted by the JSON budget. A target-scoped lookup needs
its own bounded worker request and cache identity, plus cancellation and verified-fix coverage; simply
rerunning the whole check on the main thread or raising its budget would undo #230's protections.
This is larger than the small coverage follow-ups in Follow-ups 16. Preserve the whole-diagram budget
and startup chunk boundaries when adding it.
