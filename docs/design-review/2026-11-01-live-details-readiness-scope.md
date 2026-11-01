## Scope and UX review

This fix changes browser test setup only. The existing card visibility, stable placement,
pointer pin action and section expansion remain intact. No controls, text, focus policy,
camera behavior or layout change.

## Readiness contract

Global camera idle and pane settlement are unsuitable prerequisites for every Live card:
unrelated work can remain pending, and a test may intentionally have paused its page clock.
The zoomed latency cases explicitly request the stronger post-focus wait with
`settleCamera: true`; all other callers retain their original behavior.

Keep the existing controlled pending/animating/idle movement tests on the explicit option.
The additional negative control holds camera and pane markers pending while opening an
ordinary card, so accidentally restoring a global prerequisite fails deterministically.

## Alternatives

A new per-command camera completion signal would require application instrumentation and
lifecycle changes beyond this low-risk test fix. Waiting only for viewport stability still
depends on the global pane marker and does not address the reported paused-clock caller.
Removing latency settlement would lose the focus-pan race coverage, so retain it explicitly.
