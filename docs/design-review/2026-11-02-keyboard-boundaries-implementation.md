## Keyboard boundary commands UX review

The existing Inspector header gains one Selection actions overflow; no toolbar or canvas control is
added. Menus and Ctrl+K share action registrations and searchable destination labels, parent paths
and member counts. Membership transfer is distinct from Add boundary and Remove boundary, which
continue to create/delete the box. The original Inspector membership field keeps its behavior.

Rigid preflight prevents partially moved sets and misleading success. Safe growth and membership
are committed with positions in one history step. Existing destination members stay still; mixed
selections retain their other items. Canvas/menu focus returns through the interaction controller;
Inspector invocation returns to its surviving overflow. Announcements include the selected count.

Rejected: unselected focus targets, Move focus, Toggle focused item and coordinate fields, following
the approved simplification. Subset and area selection arrive in PR B; until then the boundaries
lesson remains explicitly pointer-only rather than claiming completion through Skip.

Edge Focus uses a separate navigation cause with a strict below-50% threshold and actual edge
endpoints. The deterministic regression compares keyboard and pointer framing and keeps an explicit
50% case. Existing pointer gestures and node-navigation threshold retain their contracts.
