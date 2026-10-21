## Engine R5 UX review

The correction restores throughput for zero-local-work callers without adding controls or chrome.
The simulation documentation explains replies versus retained capacity in user terms before the
technical formula, and explicitly names the remaining approximation gaps with scale-one guidance.
The existing Live controls, heat map, narration Continue and Retry actions remain the interaction
surfaces. Browser regressions exercise playback while capacity downloads, keyboard focus in an
open presentation menu, and narration download failure/retry. The delayed-download regression
exposed narration stealing focus; the focus policy now tracks open surfaces and leaves focus
with them. Escape still returns focus to the menu opener, and Continue stays available. No layout or visual output change
is intended; no new showcase feature is introduced. Chrome budget and progressive disclosure stay
unchanged. No UX blocker identified in this scope.
