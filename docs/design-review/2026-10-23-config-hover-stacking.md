## One hover card for dependency settings

The new flow-label hit handling also claimed dependency labels. That opened two overlapping cards for a single hover and hid the settings and underlying node ring. Dependency labels now retain their existing settings interaction; flow-label readouts and dependency-line readouts retain their behavior. No controls or UI text were added.

Rejected raising z-indexes: the second card is an unintended competing interaction, so changing paint order would only conceal the cause. Kept the hover-stacking assertions unchanged.

## Read-only export size

The merged viewer exceeded the skill ZIP limit by 209 bytes. Its existing editor-only module swaps now also omit connection-placement gestures: a read-only file cannot draw a connection or drop one to open quick-add. The existing ZIP limit regression failed at 835,209 bytes before this change and passes afterward; no budget was raised.
