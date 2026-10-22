## PR #236 retry review fixes

The inspector retains the existing Retries selector and progressive disclosure; no controls or chrome were added. Off changes only the attempt count. Re-enabling restores the user's policy, so both ordinary edits and the upgrade's keep-off choice remain predictable and undoable.

Keyboard-driven production browser coverage checks both initially disabled and newly disabled custom policies, alongside existing English, Arabic and pseudo-locale inspector and Calls-hover coverage at 1024 px. The changed browser spec passed three repetitions (27 executions). Deliberately restoring the old selector handler made both new retention tests fail on the lost settings.

Failure reasons now follow the same semantics across services, databases, gateways and APIs. Managed concurrency is throttling per the approved design; local recursion safeguards and invalid configuration remain terminal. No new wording or global affordances are needed.
