## Native latency scrolling

The recurring macOS latency-details flake is a scroll-completion race. Native traces show scrollTop reaching zero and then moving again while the card's layout stays unchanged. A prior pointer/key gesture was still completing on the compositor; camera-idle waits from #392 could not acknowledge that browser-owned work.

The driver registers scrollend before each scrolling gesture and awaits it before the next gesture. A control already at its requested boundary needs no scroll event. Exact top/bottom, PageUp/PageDown and focus-return assertions remain unchanged. No timeout, tolerance, retry or application behavior changes.

Windows: the regression plus both embed/presentation cases pass five repeats (15/15). Temporarily removing the scroll acknowledgement makes the new real-wheel regression fail. macOS is checked by the dispatched branch Nightly; local Windows success alone does not establish its native rate. No parity changes are expected.
