## Deadline review UX check

The targeted designer review checked timeout editing, effective saved overrides, caller details
and browser regressions against the UX principles. The fixes add no controls or top-bar chrome.
Timeout remains beside While waiting, with optional policy detail in the existing inspector.

Incomplete keyboard drafts keep the saved value and expose `aria-invalid` plus linked feedback.
The review also identified silent fractional rejection; deadline-specific integer validation now
provides the same feedback, while blur restores the saved whole-millisecond value. Other numeric
fields keep their spinner-step semantics. Persistence checks advance the installed autosave clock
before asserting the saved policy.

Clearing a saved deadline explicitly means no timeout; an omitted override still means inherit.
Both compact detail layouts retain text for nonzero timeout and discarded-reply counts. Browser
coverage forces both layout classes to verify CSS retention, alongside the showcase's normal
hover. Natural constrained placement remains covered by the existing detail/inspector neighbours.

No blocking UX finding remains. Cyclic capacity planning is a separate documented follow-up.
