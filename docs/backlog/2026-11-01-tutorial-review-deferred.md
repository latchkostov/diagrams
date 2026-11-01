## Stable authored timeline-note identity — #412 R-efb37af90f

Still open. `authoredSimulation` identifies tutorial notes by time/action or text. Moving and rewording the startup pause can retain the edited pause alongside the restored reference pause and interrupt reconstruction.

Defer to a focused model/editor correspondence change: note identity must survive timeline editing and save/import without identifying unrelated learner notes as tutorial-owned. Adding only another time/text heuristic is unsafe; changing the persisted timeline contract needs schema and preservation coverage beyond this tutorial patch. Regress a moved, reworded pause, preserve unrelated notes, and prove reconstruction reaches Ready after repair.

## Bind real room observations to their mounted document — #402 R-fd7225032d and collaboration half of R-8ecc02383f

Still open. The initiating canvas identity is retained for pending-work cancellation, while entering a room mounts a different editor identity. Leave observations can therefore be rejected by a runner bound to the room editor.

Keep cancellation ownership separate from membership observation ownership. Add an explicit room-editor binding at mount, and cover leave after remount and navigation away while a join is pending. Reading whichever canvas happens to be current at leave would misattribute an old room's event.

The existing real-room browser test observes producer events after exiting the tutorial. A proper admitted-join regression must host the connected runner across the real room-editor mount, exercise rejected/cancelled consent and admission, and assert actual step completion. That fixture belongs with the binding change; fake publications do not resolve this gap. The AI half now keeps its runner connected and verifies a refused reply before a successful real applied turn.
