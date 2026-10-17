## UX review batch: Inspector, export and collaboration (2026-10-17)

Text summary of the owner's supplied UX review, performed on public examples and invented fixtures at
1280–3440 px, including Arabic and the pseudo-locale. The original screenshots stay outside this repository.

### Verdicts

| Surface                    | Review verdict                   | Decision                                                                                                                  |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Resizable Inspector (#145) | Adjust                           | Keep the interaction model; repair opening/closing fits, route columns and narrow summaries, width caps and localization. |
| Collaboration C1a (#143)   | Keep in the Lab, with copy fixes | Explain invalid links honestly and replace the unsaved status with one message and a file-copy action.                    |
| Collaboration C0 (#141)    | Keep as a spike                  | Add the bounded connection failure and Retry/file fallback before any productization.                                     |
| Export progress (#142)     | Simplify                         | One indicator, “Exporting PNG…” wording, and progress allocated to SVG preparation and fonts before cloning.              |
| Follow-ups 3 (#144)        | Keep                             | Preserve boundary refits; repair annotation identity after validation changes duplicate IDs.                              |
| Whole-app chrome           | Keep                             | No new production controls. The node menu remains at its 12-item cap.                                                     |

### Findings and decisions

Opening the Inspector hid the right column at 1280–1440 px while dragging already refitted correctly.
Open, close and completed resize now share the pane revision path. Fitted editing and Live views refit;
manual cameras retain zoom and pan only as needed to reveal the selection. A narration retains its explicit
focus. A playing fit-mode slow-motion camera replans without rebuilding the replay; paused and manually
owned replay cameras keep their view. Deferred pane changes are observable to browser-test readiness helpers.

Route-table Order and Match headings need separate space, including expanded translations. Last wraps at
word boundaries. A target list shows its full text when it fits and its first target plus a count when it
does not; the title and accessible row name retain every target. The width change in #145 had removed the
Round 44 `targetsText` summary in commit `391857e7`. Final screenshots in en, ar and en-XA also caught the
pseudo-locale compact summary clipping; a minimum target-column measure and a text-fit assertion cover it.

The manual sheet maximum becomes 960 px while retaining the 60vw and minimum-canvas constraints. Saved
preferences are clamped when applied. Fields have a 640 px measure; tables keep the sheet's available space.
Inspector labels, descriptions and accessible names use the catalog; resize strings and spoken pixel values
are localized. English fallback remains available for untranslated messages, as documented in I18N.md.

The export toast replaces its spinner with the bar after the first progress value. Preparation gets real
progress weight, and the menu's “Export” verb carries through to “Exporting”. Cancel, Escape and focus return
retain their existing behavior. Existing cancellation checks after encoding and before download already cover
the review's suggested final abort check; adding another identical check was unnecessary.

An unanswered room attempt becomes an alert after a bounded wait on the session clock. Retry restarts
discovery while retaining the CRDT and local edits, and a file fallback remains available. Invalid links say
they are damaged or incomplete and offer an explicit new room. Storage failure replaces the ordinary status
instead of appending another sentence; the message and action have a layout gap in Arabic and en-XA too.

### Don't change

- Keep the full-height 9 px resize hit strip, quiet 1 px idle edge, and grip visible only on hover/focus.
- Keep spatial RTL arrows, 16 px steps (Shift 64), Home/End, Enter and double-click reset.
- Keep one device-wide persisted width, saved on release, across every Inspector mode.
- Keep the fixed 296 px sheet and hidden handle at ≤1100 px, and the 640 px default cap on large displays.
- Keep the owner's default width slope; the suggested 22vw slope is optional and was not adopted in this batch.
- Keep one export toast, Cancel as its one action, Escape cancellation, focus return and silent cancellation.
- Keep collaboration Lab-only; participants and product sharing remain C1b/c work. Preserve the public-service
  IP notice and explicit Connect consent.
- Keep the top bar at seven production controls. Do not add a node-menu item at its current cap.

### Deferred observations

The copied recovery-link feedback, duplicate Live hover explanation, advanced planning-model disclosure and
future node-menu consolidation are recorded in a separate backlog fragment. They do not require another
control in this batch. Performance work, benchmarks, and the portable-gate branch's flake list remain separate.
