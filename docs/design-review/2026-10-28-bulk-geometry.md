## Bulk geometry experiment

The prototype added no controls or chrome and retained the complete diagram DOM, accessible names,
selection, history and export capture lifecycle. Review identified explicit guards for removing an
overlay while its animation was cached, a WAAPI entrance starting without a DOM mutation, and the
exact identity scale settling without a changed camera transform. Those cases were exercised during
the experiment; readiness could not accept an earlier sample or reuse stale title metrics.

## Decision

The controlled same-job comparison missed the requested 10% improvement. The product prototype and
its viewer specializations were rejected and restored to master. The shipped change is measurement
tooling and a blocker report, so the application has no new user flow or visual behavior to approve.
All original readiness, camera, label, annotation and inspector contracts remain in place. This review
does not claim that the 1–2 second performance target was achieved.
