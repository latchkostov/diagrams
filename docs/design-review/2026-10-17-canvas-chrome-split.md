## Canvas chrome extraction review

The same controls and overlays render in the same order, under the same conditions, with
identical DOM, classes, ARIA and test ids. The chrome budget, progressive disclosure and
empty-state paths are unchanged. Measurement hooks stay in CanvasView's existing sequence;
no viewport writes, timers or layout effects were added.
