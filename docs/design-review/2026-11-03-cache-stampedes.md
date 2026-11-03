## Stampede and coalescing UX review

Reviewed the public four-node comparison, its Live callout and inspector screenshots, the new Black Friday story, and the component/editor diff against the chrome budget and progressive-disclosure rules. The expiry checkbox stays in the existing cache inspector fold, defaults off and explains real CDN defaults. The callout has one confirmed action; the toast names the edited simulation and offers keyboard Undo. Existing pill placement reserves labels, nodes and readouts. There are no new top-bar or Live transport controls.

## Findings resolved

The designer-agent review found four issues: memo equality omitted herd data; successfully held waiters inherited warning colour; a routed lesson chose the first origin; and unrelated source latency could trigger cache trouble. The comparator now follows herd fields, held waiters stay neutral, peak observations retain their actual origin edge, and detection reads only upstream sources. A mounted rerender test and routed/source-isolation regressions protect these corrections.

Coalescing-only edits keep current fetches and waiters visible while they drain. Confirmation counts two later expiries of the same tracked item; it cannot certify two different items as two expiries. Events remains the action when evidence is insufficient, including an expiry too early to have a measured latency baseline.

The final origin-menu review keeps the toggle inside the existing Simulation submenu. A single storing rule shares the confirmed preset; multiple rules open the existing inspector. A routed connection must be the unambiguous origin target; otherwise the node's Properties → Cache rules remains available. This resolves the reviewer's unrelated-beacon finding without extra chrome or a misleading connection-scoped edit.

The production browser regression also caught the initial Live inspector hiding fields despite an explicit named-focus request. A fresh node panel now opens Edit properties for that request, as it already did for later requests. The test fails with the former behavior and passes with the fix; the designer approved this correction.

The Expected readout and Inputs derivations keep the same fresh-hit percentage while showing the lower coalesced origin rate. Fractional fetch rates remain visible instead of rounding to zero. The cold-cache full-rate sentence appears only for independent misses, because coalescing also collapses cold cohorts. The example's start-card summary states its first fix. Waiting and cumulative coalesced copy share one ICU message without changing the rendered words.

## Disposition

Designer-agent review approved the corrected diff, subject to the required gates. Public screenshots are stored under `C:/Users/latch/bin/codex-tasks/cdn-3-shots/`. The new example shows expiry trouble within its first ten seconds and offers a same-seed comparison with unchanged expectation thresholds. The next ladder step remains PR 4.
