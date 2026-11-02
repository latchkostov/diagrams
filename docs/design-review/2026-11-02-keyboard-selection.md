## Proposal and review boundary

Phase 2 design, approved with orchestrator changes on 2026-11-02. The product goals are keyboard
equivalents for subset selection, box selection and boundary adoption, plus readable Focus for
keyboard edge navigation below 50%. Simple by default: focus and selection always move together.

Menus and searchable commands provide every operation. Shift extends the existing Ctrl+Alt
navigation family as an accelerator; menus remain available when the OS or screen reader takes it.
Do not add a selection mode that silently changes Tab or existing navigation keys.

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

## Extend and remove from selection

Use a **Select** submenu on item and selection context menus: **Extend selection…**,
**Remove from selection…**, **Inside this area…**, and existing **Select similar** where applicable.
Preserve existing action IDs and palette names. Every menu level stays at twelve rows or fewer. The empty
canvas right-click keeps Select all and its row budget, so there the Select tools are in Ctrl+K and the
Inspector's Selection actions instead.

**Extend selection…** opens a searchable destination picker: Next node, Previous node, Left,
Right, Above, Below, Outgoing connection and Incoming connection, plus nodes by label, subtitle or
ID. Reuse reading order, nearest-direction and edge cycling rules. Picking adds and focuses the
destination, preserving existing selections; an already selected destination is idempotent. Nodes
do not add incident edges. Outgoing/incoming adds the connection itself. A missing destination
changes nothing and explains why.

**Ctrl+Alt+Shift+arrows** and **Ctrl+Alt+Shift+]/[** (⌃⌥⇧ on Mac) extend in that direction.
Show these accelerators in menu rows and shortcut help, with the menu fallback note. Exact modifier
matching must prevent unshifted navigation, nudging, quick-add or clone from also firing.

**Remove from selection…** lists only currently selected items in a searchable picker. Picking
removes that item; focus moves to the next remaining selected item in reading order, wrapping if
needed, or the canvas when none remains. Announce **Orders API removed. 2 selected.** Selection
changes create no history step. There is no unselected focus target, Move focus or Toggle command.

Use the interaction controller for focus and invoker return. Revalidate deleted/hidden targets.
Cancelling restores the invoker without changing selection. Pointer context selection is unchanged.

## A keyboard rectangle

**Select ▸ Inside this area…** opens a small dialog, not a canvas mode. Its **From node / To
node** searchable pickers define the enclosing rectangle of two nodes using full rendered bounds.
Default them from the current selection's extremes when there is a selection. There are no numeric
coordinate fields: diagram coordinates have no useful meaning for this task. If the arrange
lesson's exact target set cannot be reached with these two pickers, its keyboard solution uses
Extend selection instead, leaving completion checks unchanged.

Default **Wholly inside** on, matching the command name; off selects **Touching this area**, using
the pointer box's touching rule. **Add to selection**, off by default, is the explicit equivalent
of starting a Shift-drag. Require two surviving nodes and a positive enclosing area. Use measured absolute bounds and filter hidden or
unselectable items as the pointer selector does. Boundaries/zones require containment in both
settings; include visible connections only when both endpoints are selected, with the same union
behavior as a Shift-box. A selected boundary does not implicitly add its members to the pick.

Draw a temporary labelled outline and show the prospective selection count while picks change.
Preview changes neither selection nor document. **Select** is the single primary action; Escape
cancels without changing selection. On apply, select the computed set, focus the first selected
node in reading order (otherwise the first connection, otherwise the canvas), and announce the
count. Nothing moves and there is no history step. Keep the outline out of exports and read-only
surfaces. Keys inside the pickers never nudge canvas items.

## Add to boundary and remove from boundary

Expose **Add to boundary…** and **Remove from boundary** in the node/selection right-click menu,
Ctrl+K and the Inspector's labelled **Selection actions** overflow. Group with existing boundary
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
| Ctrl+Alt+Shift+arrows; Ctrl+Alt+Shift+]/[                                      | Chrome/Firefox/Safari publish no universal guarantee for these combinations. Windows/Linux Ctrl+Alt can mean AltGr; shifted brackets are layout-dependent. Intel software can intercept the existing arrow family. GNOME uses Ctrl+Alt navigation for workspaces; desktop bindings may extend it with Shift. On macOS Control+Option is also the VoiceOver modifier. | NVDA/JAWS already use Ctrl+Alt+arrows for table navigation; VoiceOver uses Control+Option+arrows and Shift variants for navigation/interacting. No exact existing app Shift extension, but adding modifiers does not make the family safe. | Add Shift-means-extend accelerators; menu route remains guaranteed. Preserve unshifted bindings.                                                          |
| Space, Ctrl+Space, Command+Space for toggle                                    | Space scrolls a browser page; Ctrl+Space switches macOS input sources, Command+Space opens Spotlight. Input methods on Windows/Linux can also reserve space combinations.                                                                                                                                                                                            | Space already pans with drag and drives Live playback; screen readers use Space/Enter to activate controls.                                                                                                                                | No toggle concept or new Space chord.                                                                                                                     |
| Shift+arrows or Shift+Tab for extension                                        | Browsers and native fields use Shift+arrows for text selection, Shift+Tab for reverse traversal.                                                                                                                                                                                                                                                                     | The app already uses Shift+arrows for larger nudges and Shift+Tab for reverse reading order. Browse/Quick Nav may own arrows.                                                                                                              | Preserve both meanings.                                                                                                                                   |
| Ctrl+K / Command+K                                                             | Chrome/Firefox use Ctrl+K for search/address focus; browser/system/extension behavior varies, including Safari's Command shortcuts. The app already provides its palette override.                                                                                                                                                                                   | Existing app route only; not guaranteed when a reader captures keys. All commands also have menus reachable by ordinary focus/activation.                                                                                                  | Reuse existing palette scope. Add searchable names and synonyms, no global expansion.                                                                     |
| Shift+F10 / Context Menu key                                                   | Existing app context route; Windows and Firefox document it, Chrome uses Shift+F10 for context menus. Mac keyboards may require Fn for F10 or lack a Context Menu key; OS assignments may intercept it.                                                                                                                                                              | JAWS documents this route; NVDA supports ordinary context navigation. VoiceOver users can use focused app controls through their normal interaction commands.                                                                              | Reuse, with a labelled **Selection actions** overflow in the existing Inspector selection section as a Tab-reachable alternative. No new toolbar control. |
| Tab, Shift+Tab, arrows, Home/End, Enter, Space, Escape inside the new surfaces | Ordinary browser controls/menu/dialog behavior; these keys are not global commands. Search fields retain text editing behavior.                                                                                                                                                                                                                                      | Browse-mode single letters and VoiceOver Quick Nav remain reader-owned. Native/ARIA controls expose accessible names, roles, state and focus. Enter/Space activates a focused command; Escape cancels only the top surface.                | Use existing menu, picker and dialog primitives and controller focus return.                                                                              |
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
**Orders API removed. 2 selected.**, **3 selected.**,
or **Nothing selected.** Include the existing node/boundary/edge description on navigation, with the
selection count appended. Repeated identical counts must still be announced. Preview counts are
visibly labelled; announce their settled changes without reading every numeric keystroke. Selection
outlines and a separate focus ring convey state without colour alone.

Ctrl+K finds every command using selection, extend, area, box, inside, boundary, add and
remove as appropriate. Menu labels, Inspector actions and shortcut help use the same names.
The help sheet explains **Selection actions → Extend selection / Remove from selection / Inside this
area**, the Shift accelerators and the menu fallback when an OS or screen reader takes a chord.
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
dependency backlog only after both work. Owner-approved showcase exception: add no new example. The boundaries and arrange lessons
provide the working keyboard demonstrations instead. Update
UX-PRINCIPLES, shortcut help, the release fragment and every locale; regenerate authored-source
outputs as required. A Phase 1 note is not itself a shipped feature or a reason to change goldens.

Mutation-check selection preservation, removal and focus fallback, region containment/edges, boundary movement,
single-step Undo, announcements, tutorial routes and the low-zoom rule by temporarily removing
each behavior. Run the brief's units, parity, size/reserve heavy tests, Linux affected/tutorial/
selection/boundary/keyboard/lowzoom specs twice, plus timing-sensitive neighbors under the required
load. Finish with lint, typecheck and repository-wide Prettier. Record every intended golden change
and finish the implementation with a UX review. Ship two ready stacked PRs: A contains this note, edge Focus and boundary commands; B contains
selection extension/removal, Shift accelerators, area selection and remaining lesson solutions.
