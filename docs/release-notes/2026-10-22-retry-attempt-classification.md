## Each attempt keeps its own retry classification

PR #236, second review round. A call's join and its continuation are separate logical attempts, but the
classification lived on the work item and was shared between them: a join that succeeded left `success`
behind, so a continuation that was then terminated by drain grace, or by an outage after a paused join,
replied `ok: false` with a success class. Upstream transient retries never ran.

**Structure.** The classified cause is now part of the attempt's write-once outcome
(`Attempt.outcome.cause`, written with `ok` by `settleOnce`). Every terminal path settles its attempt with an
explicit cause: success, the branch's own deadline, the child's classified reply, an outage (`callee-down`),
a termination (`error`), a refusal or a call limit. A reply's class is read from the attempt that just
settled; nothing is cached on the call. A continuation is a fresh attempt that carries its join's cause
explicitly and replies with it unless an outage or termination ends it first.

- Classification runs only where retries execute (`p3-w2` with a retry policy). Elsewhere no outcome is
  classified, and reply codes are exactly as before. `classifyOutcome` is a lookup into one frozen table.
- A Request blocked by a deny rule is terminal upstream (404, never retried), as a missing route is; it was
  previously an unclassified failure that upstream callers retried as transient.
- A backoff releases exactly the dots it charged to its connection's `backingOff`, so a partial dot no longer
  drives the gauge negative across a live scale edit.

**Skill download.** The engine change grew the skill ZIP to 835,158 B against the unchanged 835,000 B cap.
`scripts/lib/spec.json` now keeps arrays of plain values on one line (still one space of indent), which brings
the ZIP to 834,417 B. Only `node/skill/files.json` changes among the goldens (the `spec.json` hash and size);
no `w2-*` or other golden changes.
