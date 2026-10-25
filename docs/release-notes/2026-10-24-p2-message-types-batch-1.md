## Message types: batch 1

- MT-01: Pass all returns focus to a surviving type chip or Add after clearing an oversized filter.
- MT-02: Search reaches every selected filter value, including imported overflow selections, with individual keyboard removal and focus recovery. Rendering remains capped at 100 selected and 100 unselected choices.
- MT-03: Carries gains keyboard-accessible search only above 100 names. Exact searches reveal omitted names; broad searches still render at most 100 chips. A query stops filtering when the list shrinks enough to hide its search control.
- MT-04: A focused message card owns the first Escape through the interaction controller. Selection and edge focus survive; the next Escape reaches the canvas. Card dismissal and the picker's add lifecycle use machines; picker focus moves go through the focus policy.
- MT-05: Focused message cards wrap arbitrary long tokens within their bounded width, including at a short viewport.
- MT-08: Edge readers bind events and resolve labels and lines within their owning React Flow root. A new two-canvas Lab preset uses overlapping edge IDs and distinct invented vocabularies.
- MT-09: An appended rule retains its editable identities across rename and Undo, stays visible when earlier rows are deleted or restored, and remains keyboard-reachable outside the current page.
- MT-10: Stronger bulk Emits coverage preserves two distinct saved maps through incomplete arrow syntax, incomplete JSON and invalid JSON values. A valid edit applies to both nodes; one Undo restores both maps. The existing parsing guard already implements this behavior.

## Regression mutation checks

Temporarily restored the original picker, MessageFields, message card, reader and card styling, and replaced the bulk Emits parser boundary with `parseEmits(...) ?? undefined`. All eight targeted browser regressions failed: clearing focus, overflow search/removal, Carries search, Escape precedence, token wrapping, canvas ownership, rekey Undo visibility and invalid draft preservation. Restored every fix afterward.

Separate unit mutations break picker finish, card dismissal, Escape stack order and immediate picker focus. Each is rejected by its focused regression. Additional browser mutations exercise the render caps, the recovery target after removing the final search result, hidden-query behavior and the appended row after an earlier deletion. The existing held-chunk and failed-download regressions cover the modified lazy surfaces.

## Output parity

Only `tests/parity/goldens/node/i18n/catalogs.json` changes intentionally: the new `messageTypes.search` English label adds one message to each of the 38 catalog inventories, one English fallback to each of the 37 translated catalogs, and updates only the `messageTypes` area hashes. The pseudo-locale gains its generated translation without a fallback. Other sampled messages, route catalogs and selection output remain unchanged.

## Scope and decisions

Search appears only for oversized lists, inside the existing inspector. No toolbar controls or new simulation semantics are added, so no showcase simulation is needed. Rejected unbounded expansion because imported vocabularies must retain bounded rendering. Rejected document-wide listeners and replaying Escape after the fact because ownership and shortcut precedence belong to the existing canvas and controller. No limits were increased.
