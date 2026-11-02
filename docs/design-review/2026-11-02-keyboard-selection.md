## Proposal and review boundary

Phase 1 proposal, 2026-11-02. Await owner/orchestrator review before implementation. This commit
changes only this note. The approved product goals are keyboard equivalents for subset selection,
box selection and boundary adoption, plus readable Focus for keyboard edge navigation below 50%.
The particular commands below are proposed, not yet approved or shipped.

Recommend **commands without new chords**. Adding Shift to Ctrl+Alt navigation is attractive but
inherits serious desktop, international-layout and screen-reader conflicts. Every operation must be
available through ordinary menus and searchable commands without disabling assistive technology.
Do not add a selection mode that silently changes what Tab or the existing navigation keys do.

## Current implementation and constraints

- `src/editor/shortcuts.ts` owns matching and shortcut labels; `useCanvasShortcuts.ts` filters
  editable fields, composition and overlays. Arrows nudge, Shift+arrows nudge farther, Alt+arrows
  quick-add, Alt+Shift+arrows clone. Tab/Shift+Tab, Ctrl+Alt+arrows and Ctrl+Alt+]/[ navigate.
- `src/canvas/selection/useCanvasNavigation.ts` currently replaces selection in `goNode`/`goEdge`,
  then dispatches `selection.changed` with a keyboard target. It already uses the controller's
  pending target for consecutive keys received before focus lands. Preserve that ordering property.
- `src/canvas/interaction/` is the sole owner of canvas focus and menus. Its pure focus policy,
  commands, measurement readiness and cause journal are the extension points. Selection remains
  editor state; selection changes never become document history steps.
- `useBoxSelection.ts` uses `pickInBox` and `edgesBetween`: touching by default, wholly inside with
  Ctrl/Command, boundaries and zones wholly inside in either case, visible edges with both ends
  picked, Shift to add. Reuse those rules rather than creating another spatial selector.
- The single/bulk Inspector Boundary fields already assign membership through `updateNode` and
  `updateNodes`; these are not a physical drop equivalent. `useEditor.ts` also has membership
  settlement, safe boundary growth, placement and atomic history paths to build upon.
- The keyboard context-menu handler currently selects an unselected focused item before opening.
  An explicit focus-only command therefore also needs a keyboard menu path that preserves its
  selection. Pointer right-click behavior stays unchanged.

## Extend, move focus, and toggle

Use a **Select** submenu on the canvas/item/selection context menus. Its rows are **Extend
selection…**, **Move focus…**, **Toggle focused item**, **Inside this area…**, and the existing
**Select similar** where applicable. Keep existing action IDs and palette names working when
folding Select similar into this submenu. Count menu rows during implementation: every level stays
at twelve or fewer, no toolbar addition, no new permanent canvas controls.

**Extend selection…** opens a searchable destination picker. Its navigation choices are Next node,
Previous node, Left, Right, Above, Below, Outgoing connection and Incoming connection; searching
also finds a node directly by label, subtitle or ID. Reading order, nearest-direction rules and
edge cycling are the existing navigation rules. A missing destination changes nothing and says
why. Picking a destination closes the picker, adds that item to the existing set and focuses it.
Existing selections are retained exactly; selecting an already selected destination is idempotent.
Extending to a node does not automatically select its incident edges. Outgoing/incoming extends to
the connection itself, not its other endpoint, matching existing edge navigation.

**Move focus…** uses the same picker and navigation choices, but leaves every selection flag alone.
This gives the keyboard a way to reach an unselected item before toggling it. The focused item has
the existing visible keyboard focus ring; selected items retain their selection outline. The
Inspector continues to represent the selection, not the unselected focus target. Reveal the focus
target, rather than framing the entire retained selection. The destination is the canvas's roving
stop even when it is not selected.

**Toggle focused item** adds or removes only the item that had canvas focus before the menu or
palette opened. The wording covers nodes, connections, annotations and boundaries; a boundary's
toggle selects its box, not its descendants. Focus stays on that item, including after removal
and after removing the last selected item. With no surviving focused item, disable the action
with an explanation rather than guessing from the first selected node.

Capture the canvas target before opening a menu/palette and retain it through the controller;
never use the menu row or palette input as the toggle operand. Preserve the set when a keyboard
context menu opens on an explicitly focused, unselected item. Its edit commands act on the
selection unless explicitly labelled as acting on that focused item. This is necessary for the new
focus-only route; ordinary navigation still replaces selection, and pointer context selection is
unchanged. Cancelling a picker restores its invoker without selecting it. Deleted/hidden targets
are revalidated; fall back through the controller, never onto a detached element.

Example: navigate normally to A; Extend selection → Right adds B and focuses B; Extend selection
→ Right adds C and focuses C. Move focus → Previous node focuses B without changing A/B/C.
Toggle focused item removes B, leaving A/C selected and B focused. No extra Undo step is created.

## A keyboard rectangle

**Select ▸ Inside this area…** opens one small dialog, not a canvas mode. It starts with the
selected items' enclosing rectangle, or the focused item's rectangle when nothing is selected.
Without either, use the visible canvas rectangle in diagram coordinates. Show **Left**, **Top**,
**Right** and **Bottom** as labelled numeric fields. A **From node / To node** pair of searchable
pickers can seed the enclosing rectangle of two nodes; use their full rendered bounds, not their
centres. Editing the four bounds afterwards reaches rectangles that no two node boxes describe.
This matters for the arrange lesson: its horizontal extremes are not also its vertical extremes.

Default **Wholly inside** on, matching the command name; off selects **Touching this area**, using
the pointer box's touching rule. **Add to selection**, off by default, is the explicit equivalent
of starting a Shift-drag. Normalize reversed bounds, permit negative diagram coordinates, reject
non-finite inputs, and require positive area. Use measured absolute bounds and filter hidden or
unselectable items as the pointer selector does. Boundaries/zones require containment in both
settings; include visible connections only when both endpoints are selected, with the same union
behavior as a Shift-box. A selected boundary does not implicitly add its members to the pick.

Draw a temporary labelled outline and show the prospective selection count while fields change.
Preview changes neither selection nor document. **Select** is the single primary action; Escape
cancels without changing selection. On apply, select the computed set, focus the first selected
node in reading order (otherwise the first connection, otherwise the canvas), and announce the
count. Nothing moves and there is no history step. Keep the outline out of exports and read-only
surfaces. Arrow keys inside numeric fields edit those fields; they never nudge canvas items.

## Add to boundary and remove from boundary

Expose **Add to boundary…** and **Remove from boundary** in the node/selection right-click menu,
Ctrl+K and the Inspector's existing Boundary section overflow. Group with existing boundary
actions if needed to meet the menu budget. Keep **Add boundary** (Ctrl/Command+G) and **Remove
boundary** meaning create/delete the box; neither becomes membership transfer. Keep the existing
membership field's behavior; the new commands explicitly describe physical movement.

Add opens a searchable boundary chooser, with label, parent path and member count to distinguish
equal names. It acts on explicitly selected diagram nodes; mixed selections retain their other
items but the chooser states the number of nodes being moved. Annotations/boundary boxes are not
silently expanded into operands. No eligible node means an explanation, no edit. Nodes already in
the chosen boundary are unchanged and do not count as additions.

Plan the entire move against one document snapshot. Keep the moved nodes' relative positions,
translate them to the nearest collision-free place inside the chosen boundary, and set membership
there. Nodes already wholly inside the requested boundary need no translation. Respect nested
boundaries: the chosen boundary must actually be the containing owner, not a child whose region
happens to cover the landing place. Reuse the existing padding, overlap and growth constraints;
grow the destination only when it does not cover unrelated nodes/boundaries. Existing members,
unselected nodes and other boundaries do not move; source boundaries do not shrink automatically.
If the complete set cannot fit safely, apply nothing and say **Couldn't find room. Nothing moved.**

Remove acts on selected diagram nodes that belong to a boundary. Move each source-boundary subset
together to the nearest free place outside all boundaries, keeping relative positions within that
subset, and clear membership. This explicit inverse means **not in a boundary**, including for a
nested member; do not silently promote it into its parent. Never delete the boundary or move its
other members. Plan all subsets together; failure of any placement rejects the entire operation.
Already unassigned nodes are unchanged. Metadata-only removal while leaving a node visually inside
would contradict the membership-by-centre contract, so it is rejected.

One successful command is one undo step containing positions, membership and any boundary growth.
Keep the selection. From a keyboard canvas/menu/palette invocation, return focus to the surviving
focused node, else the first selected node, and reveal it. From the Inspector, keep focus on its
surviving control and let the roving stop follow the selection. Announce **Added 3 nodes to Region A.
3 selected.** or **Removed 3 nodes from boundaries. 3 selected.** and offer Undo. On canvas Undo,
restore the document and history selection with **Undone. 3 selected.** (one item: **Undone. Orders
API selected.**); Redo follows the same existing contract. Toolbar/panel Undo keeps focus there.
No-op, cancelled and rejected operations create no history step or misleading success toast.

## Conflict audit and shortcut decision

This is a source-based audit, not a claim of native browser/assistive-technology testing. Desktop
bindings and extensions are customizable; a missing default conflict cannot prove availability.

| Key or route                                                                   | Browser and platform audit                                                                                                                                                                                                                                                                                                                                           | Screen reader and app audit                                                                                                                                                                                                                | Decision                                                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+Alt+Shift+arrows; Ctrl+Alt+Shift+]/[                                      | Chrome/Firefox/Safari publish no universal guarantee for these combinations. Windows/Linux Ctrl+Alt can mean AltGr; shifted brackets are layout-dependent. Intel software can intercept the existing arrow family. GNOME uses Ctrl+Alt navigation for workspaces; desktop bindings may extend it with Shift. On macOS Control+Option is also the VoiceOver modifier. | NVDA/JAWS already use Ctrl+Alt+arrows for table navigation; VoiceOver uses Control+Option+arrows and Shift variants for navigation/interacting. No exact existing app Shift extension, but adding modifiers does not make the family safe. | Do not add. Extend/move commands provide the whole function. Keep existing unshifted bindings.                                                            |
| Space, Ctrl+Space, Command+Space for toggle                                    | Space scrolls a browser page; Ctrl+Space switches macOS input sources, Command+Space opens Spotlight. Input methods on Windows/Linux can also reserve space combinations.                                                                                                                                                                                            | Space already pans with drag and drives Live playback; screen readers use Space/Enter to activate controls.                                                                                                                                | No new toggle chord. Use the named command.                                                                                                               |
| Shift+arrows or Shift+Tab for extension                                        | Browsers and native fields use Shift+arrows for text selection, Shift+Tab for reverse traversal.                                                                                                                                                                                                                                                                     | The app already uses Shift+arrows for larger nudges and Shift+Tab for reverse reading order. Browse/Quick Nav may own arrows.                                                                                                              | Preserve both meanings.                                                                                                                                   |
| Ctrl+K / Command+K                                                             | Chrome/Firefox use Ctrl+K for search/address focus; browser/system/extension behavior varies, including Safari's Command shortcuts. The app already provides its palette override.                                                                                                                                                                                   | Existing app route only; not guaranteed when a reader captures keys. All commands also have menus reachable by ordinary focus/activation.                                                                                                  | Reuse existing palette scope. Add searchable names and synonyms, no global expansion.                                                                     |
| Shift+F10 / Context Menu key                                                   | Existing app context route; Windows and Firefox document it, Chrome uses Shift+F10 for context menus. Mac keyboards may require Fn for F10 or lack a Context Menu key; OS assignments may intercept it.                                                                                                                                                              | JAWS documents this route; NVDA supports ordinary context navigation. VoiceOver users can use focused app controls through their normal interaction commands.                                                                              | Reuse, with a labelled **Selection actions** overflow in the existing Inspector selection section as a Tab-reachable alternative. No new toolbar control. |
| Tab, Shift+Tab, arrows, Home/End, Enter, Space, Escape inside the new surfaces | Ordinary browser controls/menu/dialog behavior; these keys are not global commands. Fields retain text and numeric editing behavior.                                                                                                                                                                                                                                 | Browse-mode single letters and VoiceOver Quick Nav remain reader-owned. Native/ARIA controls expose accessible names, roles, state and focus. Enter/Space activates a focused command; Escape cancels only the top surface.                | Use existing menu, picker and dialog primitives and controller focus return.                                                                              |
| Ctrl+Alt+]/[ (retained edge navigation)                                        | International brackets/AltGr remain a known limitation. Never substitute Command+Option: Chrome/Safari/macOS also use Command combinations for tab/history navigation.                                                                                                                                                                                               | Retain existing matching and scope. Named Outgoing/Incoming connection choices are the alternative when a reader/OS captures the chord.                                                                                                    | Meaning stays navigate to connection; only the approved below-50% camera result changes.                                                                  |

Sources checked 2026-11-02: [Chrome shortcuts](https://support.google.com/chrome/answer/157179),
[Firefox shortcuts](https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly),
[Safari shortcuts](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac),
[Windows shortcuts](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows),
[Intel hotkey interception](https://www.intel.com/content/www/us/en/support/articles/000057495/graphics/graphics-for-10th-generation-intel-processors.html),
[AltGr modifier behavior](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState),
[Mac input sources](https://support.apple.com/en-ie/102650),
[Spotlight](https://support.apple.com/guide/mac-help/spotlight-keyboard-shortcuts-mh26783/mac),
[GNOME workspaces](https://help.gnome.org/gnome-help/shell-workspaces-switch.html),
[KDE global shortcuts](https://docs.kde.org/trunk_kf6/en/khelpcenter/fundamentals/kbd.html),
[NVDA commands](https://download.nvaccess.org/documentation/en/keyCommands.html),
[JAWS commands](https://www.freedomscientific.com/training/jaws/hotkeys/), and
[VoiceOver navigation](https://support.apple.com/en-ca/guide/voiceover/cpvokys04/mac).

## Announcements, discovery and preservation

Announce committed changes through the existing polite live region: **Orders API added. 3 selected.**,
**Orders API removed. 2 selected.**, **Orders API focused, not selected. 2 selected.**, **3 selected.**,
or **Nothing selected.** Include the existing node/boundary/edge description on navigation, with the
selection count appended. Repeated identical counts must still be announced. Preview counts are
visibly labelled; announce their settled changes without reading every numeric keystroke. Selection
outlines and a separate focus ring convey state without colour alone.

Ctrl+K finds every command using selection, extend, toggle, area, box, inside, boundary, add and
remove as appropriate. Menu labels, Inspector actions and shortcut help use the same names.
The help sheet explains **Selection actions → Extend selection / Toggle focused item / Inside this
area** and the existing menu/palette shortcuts; it must not advertise a nonexistent new chord.
The Inspector's Selection actions overflow exposes the same Select commands even for an empty
selection, so losing the last selection does not remove the Tab-reachable route back.

Existing Tab/Shift+Tab and Ctrl+Alt navigation still replace selection; arrows still nudge,
Alt+arrows still quick-add, Alt+Shift+arrows still clone. Enter/F2, segment brackets, Select all,
Select similar, Add boundary and Escape keep their meanings. Existing Shift-click, Ctrl/Command-click,
box-drag, node-drop, touch, pen, long-press and panning gestures are unchanged. These editing commands
are unavailable in Live, presentation, read-only views and embeds; existing Live navigation remains.
No new persistent settings or backend are involved.

## Edge navigation enters readable Focus

Below **0.5** zoom in Edit, navigating to an edge with Ctrl+Alt+]/[ must enter the same readable
Focus as clicking that edge. Frame both endpoints and the existing one-hop context with current
Focus geometry (about 112% for the reviewed fixture), keeping its readable floor and normal cap.
At exactly 50% keep the existing boundary behavior; this decision does not redefine node navigation
or the current focus-reveal threshold. Do not globally change the existing 0.6 keyboard-node rule.

The current navigation reveal lacks the keyboard context supplied by focus reveals, and edge-only
selection must frame endpoints rather than fall back to the first diagram node. Make cause and
target explicit through the interaction/camera controller. Do not depend on focusin racing with
the navigation reveal, or on the Inspector's opening happening to trigger Focus.

`tests/e2e/lowzoom-review.spec.ts` currently sets 50%, then assumes the view stays there after an
intervening node click. Separate that threshold case from the below-50% navigation test. Establish
the node focus first, set a known below-threshold manual zoom immediately before navigating, then
wait on controller/camera readiness. Assert the exact selected/focused edge, settings visibility,
Focus state, readable settled zoom and endpoint visibility. Compare to the same fixture's settled
pointer Focus result, including zoom/geometry within existing precision; do not merely change an
assertion to allow either zoom band. Cover incoming/outgoing and the exact-50% boundary explicitly.
No sleeps, retries, wider timeouts or budget changes.

## Agents and implementation plan after approval

Agents already have `edit_diagram` with `update` operations using `in: <boundary ref>` or `in: null`;
`applyOps` calls `placeNew` with touched boundaries and explicit outside operands. Keep that tool
surface. UI-only focus, selection and rectangle previews are not saved diagram state and need no
new WebMCP tool. Browser-driving agents can use the same named commands and test IDs. Document the
existing membership operations and verify their placement/atomic Undo behavior; do not silently
promise identical rigid-set placement if the current agent layout uses another policy. Agent calls
continue to leave camera and keyboard focus alone. Any shared planner extraction must preserve
existing agent output goldens; a tool behavior change requires separate explicit review.

After approval, add pure selection and atomic boundary planning/command tests and controller
interleavings (rapid moves, cancellation, deleted targets, menu return, Undo). Register all actions
through `src/editor/actions.ts`/the built-in registry. Put new picker/dialog UI behind the existing
lazy-surface lifecycle. No effect-and-flag state machines, direct canvas focus calls or engine edits.
Give every new interactive element a `data-testid`.

Add genuine keyboard solution variants to `boundaries` and `arrange`, exercising subset/area
selection and adoption; leave completion checks untouched and never use Skip. Resolve their dated
dependency backlog only after both work. Add an invented public showcase for the stencil/editor
feature, with applicable feature metadata, example tests and reviewed parity coverage. Update
UX-PRINCIPLES, shortcut help, the release fragment and every locale; regenerate authored-source
outputs as required. A Phase 1 note is not itself a shipped feature or a reason to change goldens.

Mutation-check selection preservation, toggle removal, region containment/edges, boundary movement,
single-step Undo, announcements, tutorial routes and the low-zoom rule by temporarily removing
each behavior. Run the brief's units, parity, size/reserve heavy tests, Linux affected/tutorial/
selection/boundary/keyboard/lowzoom specs twice, plus timing-sensitive neighbors under the required
load. Finish with lint, typecheck and repository-wide Prettier. Record every intended golden change
and finish the implementation with a UX review. Phase 1 stops after pushing this note for review.
