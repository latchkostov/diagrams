## Review: v7 rail sheet and editing hover card

The owner chose the rail-attached v7 treatment from prototype `55491faa6`. Kept the ink header, chapter marks, recap before next, small target drawing, numbered steps, shared platform-aware key chips, dimmed workbench and pinned Start/Stay/chapter/tutorial exits. The sheet adds no permanent toolbar control. A separate designer-agent review confirmed the reading hierarchy and requested accurate reconnects/edge names, scalar settings changes, language refresh and a two-row phone footer; all were addressed.

## Height and responsive behavior

A board that expands with the window wastes space at 2560. A rigid 320 px board plus the complete recap, summary, four single-column steps and footer cannot fit the available practice pane at 1440×900. The board therefore caps at 320 px and shrinks before any step is clipped. The desktop checks require the entire fourth step above the footer and no body overflow for the 1.2→1.3 handoff. Narrower/longer content retains an accessible scroll region; its keys do not reach the canvas. At 520 px the step list changes to two columns. On phones the graph stays one line and the footer keeps Start beside Stay.

## Accuracy and focus

The preview projects authored demo data onto a fresh lesson start, without executing demos or the simulation. It preserves real forks and directed edges, named/reconnected edges and inserted nodes, and does not truncate nodes or invent adjacency. Settings changes are named scalar deltas, including authored Inputs edits; missing saved values say Not set. Language changes rebuild the projection.

The old duplicate completion strip no longer consumes sheet space; its optional example/copy actions remain in the tutorial bar. Heading focus announces the handoff once; the recap appears once before the next lesson. Escape and Stay remove both the sheet and its listener and restore canvas focus. The dimmed region has the same Stay action.

A keyboard completion can precede quick-add's deferred name field. The handoff retires that pending name through the existing naming controller before taking heading focus, so its late retry cannot take focus back. Loose nodes stay beside the previewed flow, and the board's intrinsic minimum preserves wrapped title blocks instead of clipping them.

Short viewports fold the redundant next-lesson summary, retaining the recap, drawing, title, time and every step's outcome. This keeps both the 1.3 and the longer 1.4 four-step handoffs above the pinned footer at 1440×900.

## Placement regression

The Editing card formerly cached a screen rectangle when hover intent opened. Fit and other subsequent layout movement could leave that rectangle stale. The general fix remeasures the live anchor while visible and searches clear positions off the node and floating coach. It suppresses the tooltip when none fit. Regression tests fail when the old tooltip implementation is restored.

## Rejected alternatives

Did not ship the centered v6 treatment, a growing empty drawing board, prototype-only flags, extra always-visible controls, placeholder diagrams or raw settings JSON. Did not change the engine, lesson checks, pointer/keyboard solutions, bundle budgets, reserves or plugin version.
