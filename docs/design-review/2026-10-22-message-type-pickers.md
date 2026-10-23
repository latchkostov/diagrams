## Message type selection

Reviewed the Inspector and canvas against the chrome budget: no new bar controls or canvas pills. The Messages group sits in Simulation, one disclosure away; Advanced retains travel time and custom properties. Carries gives feedback before and after each filter/rename. Only pass explains that no selection passes everything. Unknown types stay editable and explain that nothing upstream sends them yet. An imported empty filter keeps its existing blocking behavior and offers Pass all message types.

## Keyboard and language

Single choices use the existing Dropdown. Multi-select chips are labelled native toggle buttons, with Tab, Space, Enter and arrow navigation. New-type entry uses Enter to add and Escape to cancel, with focus restored within the picker. New feedback is announced as a status. Processor rows keep existing string, map and wildcard semantics. RTL uses logical spacing and wrapping; Arabic and en-XA browser cases cover fitting the controls.

## Checks and loading

The Check names the type and receiver and offers only propagation-verified changes. Each choice is its own undo step. A rename that would simply create another looping type is rejected. A single-type loop with no verified safe edit explains that its routing needs a decision. Inspector controls and propagation stay outside startup and canvas-first-view chunks; held-chunk cases cover both Inspector loading and hover loading. Existing settings tooltips alone own Escape; a flow edge's native type title adds no keyboard overlay.

## Validation scope

The initial production-browser run passed 21 cases including pickers, undo, managed processor rows, Arabic and en-XA. Additional loading and Check cases and repeated Linux neighbours are requested through the shared gate; gate admission may return 75 under other active work. See the delivery report for exact completed runs and limitations.

## Closed sections and final regressions

The full unit run caught eager diagram reads while Simulation was closed. Those reads now occur inside the mounted lazy Messages components. Existing Arabic, pseudo-locale and broker-inspector serialization regressions pass; temporarily restoring the eager read fails both language regressions. The propagation and Check tests also fail when filter handling is temporarily removed. The final targeted selection passed 120 cases in each of three runs. The route snapshot updates only the intentionally added webhook callback, and all layout audit assertions remain intact.
