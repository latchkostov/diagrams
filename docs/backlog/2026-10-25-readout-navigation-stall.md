## PR #320 round-1 navigation stall

The round-1 production-build run had 118 passed and one failed browser test:
`hover-cards.spec.ts` → `edge line and call pill open the same named card`.
Its trace shows the initial HTML request spent 20.558 seconds waiting for the
response; the default 20-second navigation backstop fired before app assertions.
This was not a failed focus, hover or placement assertion.

The saved round-1 focused branch and origin/master runs each passed both repeats.
That does not reproduce the failure on master or establish a root cause. Keep the
navigation timeout and all assertions unchanged. If the stall recurs, capture
preview-server request/response timing alongside the browser trace to distinguish
server scheduling from browser delivery. Do not add navigation retries or claim
that the application focus fix resolves this infrastructure symptom.
