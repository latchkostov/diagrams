## Camera policy as one table

The camera now follows one written table (`src/canvas/camera/panePolicy.ts`) instead of rules spread across
effects. The owner's agreed rules hold:

- A panel control, shortcut, menu item or command palette entry that changes the pane refits a view owned by Fit,
  even with a selection.
- Selecting or placing an item (T, a quick-add pick, a note, a connection drop, a click, a right-click,
  double-click, Enter or Properties) never refits or zooms. It pans only when the item is covered or outside the
  remaining pane.
- A placement replaces a pending panel refit.
- Menus hold pending work, which runs once when they close. Quick-add dismissed without a pick counts as a menu.
- Shift+2 wins over reveals queued before it. Shift+0, wheel, drag and pinch make the view the user's.

What a person notices:

- An item that ends up under the minimap, the zoom controls or the title card when the Inspector narrows the pane
  is now panned clear (rule d: one overlay-aware reveal). An item near the pane's edge but fully visible stays
  put. Before, a 40–72 px margin moved it.
- A new node reveals with one short pan instead of two pans a quarter-second apart.
- Leaving or entering Live view fits once, not twice.
- After "go to node" from the command palette, toggling a panel keeps that view instead of refitting the whole
  diagram.

No controls, text or layout dimensions changed. Chrome budget unchanged. Keyboard paths unchanged.
