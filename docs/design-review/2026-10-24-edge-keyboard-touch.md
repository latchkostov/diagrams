## Line shaping: keyboard, screen readers and touch

The designer-agent review checked the approved PR 5 scope against the chrome budget, keyboard focus, announcements and touch ownership. No toolbar controls or Tab stops were added. Brackets choose a segment while the edge retains focus; its initial segment is the one under the label, otherwise the longest inner leg. The focus ring follows keyboard focus and the controller owns segment selection and guards menu, pan and pointer-gesture interleavings.

Four review findings were resolved: segment-arrow guidance now sits under Edit in the shortcuts sheet; repeated identical announcements replace a keyed text subtree within the persistent status region; the coarse-pointer connection halo loads with connection styling before the first connection; and the initial segment receives the active ring when its selected edge has keyboard focus.

Keyboard movement reuses node grid rules and exact alignment for segment merging. Pointer merge tolerance is intentionally excluded from keyboard nudges: otherwise a deliberate 1 px move or a short first step from an off-grid port disappears. Its regression fails when the original tolerance is restored.

Touch keeps the existing interaction controller and capture adapter. The release path ends ownership before implicit capture loss; cancellation never writes the document. Coarse-pointer handles grow through CSS, with touch-action suppression limited to the handles. The 22 px edge interaction path remains unchanged.

The existing generic shaped-line fixture supplies the accessibility scan. This batch adds editing affordances, so no new simulation, planning or stencil showcase is needed. Live carry preview remains quarantined, and interop/agents remain PR 6.

## Gate follow-up: pointer reachability and rapid keyboard intent

The full gate exposed a constrained active marker intercepting an edge double-click. It now remains visible for keyboard focus while both its box and pseudo-element pass pointer events through whenever the original size or label-space guard would omit a pointer handle. Ordinary mouse and coarse-pointer handles remain draggable.

The Inspector's segmented control also suppressed a fresh arrow-key choice while its previous controlled-value update was pending. Moves to another focused option now emit that intent; clicks and Home/End on the selected option retain their no-op guard. A deterministic delayed-prop unit regression covers End followed by ArrowLeft, with focus returning to the original option. The designer-agent follow-up approved both narrow fixes without changing the existing browser assertions.

The keyboard-history browser regression advances a paused fake clock through each quiet-time commit. This keeps successive nudges within the existing merge window even under CPU load, while still proving that three separate commits undo as one step.
