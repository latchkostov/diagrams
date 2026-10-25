## Pending modal Escape ownership

The most recent modal owns Escape from the moment it opens, including the interval before its
downloaded dialog mounts. Closing that pending palette preserves the earlier F2 naming request;
the Inspector label takes focus on arrival. One press dismisses one owner, without new controls.

The capture stack carries modal ownership and releases it on dismissal, field handoff or unmount.
The controller consults it before naming, gestures and transient cards. Mounted dialogs and menus
retain their existing keyboard handling. The lazy surface registry and capture callers were audited:
the palette is the only lazy modal with a type-ahead capture; searchable context menus already have
menu ownership, and Inspector/placement captures represent naming rather than a modal.

Rejected merely waiting for a dialog DOM node: Suspense can still be rendering nothing when Escape
arrives. Rejected finishing naming as well: the same key must not dismiss two input owners.
