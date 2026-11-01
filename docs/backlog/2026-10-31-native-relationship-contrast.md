## Contrast finding

Baseline Nightly 41253920016, macOS shard 7, audits Focus and the zoom percentage at 4.46:1: foreground `#717783` on `#fefefe`. Their settled foreground token is `--text-2` (`#5f6673` in light). The relationship helper waited for a scoped menu's opacity but ignored the enclosing view's entrance animation. The independent token tests retain AA on every relevant light and dark surface.

Relationship scans now acknowledge the actual view/dialog entrance promises, preserving the existing menu-opacity wait, WCAG tags, scan scopes and empty-violation assertion. The real canvas/dependency/hint audit runs in both light and dark. Native Windows passes four executions; the entrance and token units pass 19 cases. Temporarily removing the acknowledgement fails all three new held-entrance regressions.

Changing colour tokens was rejected because the settled colours pass AA in both themes; the observed colour is from the entrance. No floor, tolerance, timeout, animation duration, scope, rule, skip or golden changes. Native macOS confirmation belongs to the dispatched round-five Nightly.
