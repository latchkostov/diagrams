## Investigate the Dev phone-viewer timeout under mixed export load

The six-worker, six-CPU Linux Dev run for PR #437 passed 122 of 123 cases.
`html-export.spec.ts`'s phone playback case reached the viewer geometry poll but
exhausted its whole-test hang backstop. The same Build run passed all 123 cases.
The branch's focused phone recheck passed both repeats without any code changes.

Clean origin/master `9cb33865770b2b89aebf9c5fc7b5146900e0bca3` passed both
focused phone repeats in a Linux source volume. A matching Windows bind-mounted
clean snapshot then passed the entire HTML-export spec twice: 34 passed, zero
failed or flaky, with six workers and six CPUs. This does not establish a
pre-existing failure; the mixed-load timeout remains unreproduced.

Retain every geometry assertion and the existing timeout. If it recurs, inspect
cold Dev loading and viewer layout readiness under the mixed image-export load
before making a causal fix. No assertion, timeout, bundle reserve or golden was
relaxed in this fix round.
