# UX principles

Simple enough that a first-time visitor makes a beautiful diagram in a minute; deep enough that a
power user can model a real system and replay it in a meeting. When the two conflict, the simple
path wins by default and the power path stays one step away.

## Rules
1. **Beautiful by default.** Every default (layout, colours, edge style, simulation speed) should look
   and behave well without touching a setting. A setting that most people need to change is a bad default.
2. **Progressive disclosure.** Show the 20% of controls used 80% of the time. Everything else lives in
   context menus, the inspector, or an "Advanced" section, never in the top bar.
3. **Context over chrome.** Prefer acting on the thing itself (right-click, double-click, drag, inspector
   for the selection) over global toolbars and modes. Actions appear where and when they apply.
4. **One primary action per surface.** Each panel, dialog and bar has one obvious main action; the rest
   are visually secondary.
5. **Budget the chrome.** Top bar: at most ~7 controls. Floating bars: one row. Menus: ≤ 12 items per
   level, grouped with separators. Adding a control means removing or folding another.
6. **No dead ends, no surprises.** Everything is undoable; destructive actions say so; empty states
   explain what to do next; errors say how to fix them.
7. **Consistent affordances.** Cursor, hover, focus and pressed states match behaviour everywhere
   (pointer = click, grab = drag, text = editable). Same action, same name, same shortcut in every place.
8. **App, not page.** No browser context menu, no stray text selection, no layout jumps. Keyboard first-class.
9. **Teach in place.** Hints, shortcut labels and placeholders over docs. Discoverable from the right-click.
10. **Nothing overlaps by default.** Labels never cover nodes, parallel edges stay distinguishable,
   edges route around nodes, and floating panels never hide content after fit-view. An automated
   overlap audit (`tests/e2e/layout.spec.ts`) guards every example.
11. **Presentation is a first-class mode.** Anything shown in a meeting reads at a distance and hides editing chrome.

## Process
Every feature batch ends with a **UX review gate** before new work starts: a designer agent walks the
whole app against these rules, flags clutter and inconsistency, and simplifies (removes, merges, moves to
context) before adding. Findings go in `docs/DESIGN-REVIEW.md`.
