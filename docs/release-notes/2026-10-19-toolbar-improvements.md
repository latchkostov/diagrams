## Collapsible canvas toolbar (PR #192)

Thanks to @hfmm99 for the collapsible toolbar, grouped dividers and Fit view zoom flyout.
Collapsed tools leave keyboard navigation and the accessibility tree; expanding restores working,
localized zoom controls. Collapse is session-only and a reload starts expanded, without writing a
new storage key. The flyout has its own 24 by 30 px target, beside Fit view. Both zoom commands use
the existing camera controller; the shared interaction controller owns opening, dismissal and focus.
Fit view and collapsing close the menu. Shift+0 and Shift+2 keep their existing bindings and
shortcuts-sheet entries; they do not overlap Live's Space, Enter or Escape handling.

## Output parity

The toolbar is larger because its collapse button and dividers take space, and its split Fit control
now provides separate, non-overlapping targets. The existing overlay-aware fit measures those actual
bounds. No fit inset or diagram layout algorithm changed. Node/group coordinates, edge paths, labels,
simulation and exports stay unchanged. Viewport-only golden changes are intentional:

- `browser/layout/partitions-vs-subscriptions.json` and
  `browser/render/partitions-vs-subscriptions.json`: the taller toolbar changes the fit's vertical pan.
- `browser/layout/recommendations-feature-store.json`: the taller, wider toolbar changes the fit's
  pan and scale for this large diagram, before and after Tidy up.
- `browser/layout/blocking-call.json`: Tidy up's fitted view pans above the taller toolbar.
- `browser/layout/contoso-dmz.json`: Auto-layout's fitted view pans left to clear the wider toolbar.
- `browser/layout/delivery-dispatch.json` and `browser/layout/nightly-batch-elt.json`: fitted pan and
  scale change to clear the toolbar, before and after Tidy up.
- `node/i18n/catalogs.json`: the four toolbar messages combine with master's new messages; locale
  catalog counts and chrome fingerprints change. Translations are neither overwritten nor stamped.

The remaining incoming goldens belong to the merged master changes, not this toolbar feature.
