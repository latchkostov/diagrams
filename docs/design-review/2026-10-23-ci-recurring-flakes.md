## UX review: recurring CI flakes

These changes affect test setup only. Export still completes independently of its
notification download, Retry remains available after toast expiry, and Inputs and
Apply fix stay disabled during slow motion. The existing assertions for keyboard
focus, export, persistence, disabled controls and recovery remain in place.

Rejected increasing timeouts, dismissing the toast manually and weakening replay or
Apply-fix assertions. Readiness belongs before the assertion; the Kubernetes guard
should time the reader it claims to protect. The Inputs case uses 1,200 orders/s at quarter capacity:
Apply fix must still be enabled before capture and after replay, and all mutation
controls must remain disabled during it. The full-gate trace showed that the former
6,000/s fixture spent 14.7 seconds in background capture and reached the whole-test
backstop after its assertions had completed.
