## Dependencies, part 2 quarantine - PR #303

Hide the lesson through the existing quarantine flag so learners cannot reach an instruction whose connection
is hidden after Skip or resume. Cards, search, next suggestions and deep links share that exclusion; saved progress
is retained. No controls or runner behavior change. Webhooks, Fan-out, Partitions and Outbox stay available.
Restore the lesson only after the backlog's prerequisite regressions and retained lesson cases pass.
