## Live dock review

The dock names its subject once and puts current observations before configuration. Its four tiles use a shared component, 17px values, 11px labels and identical baselines; warnings change ink without a tile fill. The identity status remains an accessible disclosure for the Live readout. Edit properties is closed until requested, and rename keeps its existing focus and text-selection behavior.

Suppressing duplicate hover cards applies only to a single node actually represented by Properties. Undo can restore a node and its connections as a multi-selection; that is not a node readout and must keep the hover card. Keyboard reading-order traversal retains its floating readout without opening the dock. Explicit selection and Properties still open it.

## Test flows

inspector-live opens Edit properties before reading configured planning, closes Properties before comparing the floating readout, and checks Queue/In flight in the four-tile summary while Threads remains in its section. Reader-layout cases require four columns at both tested widths. Hover deletion and selected-node cases close the node dock before exercising their floating readout. Autoscaling bulk setup explicitly opens the dock only when closed. No assertions or timeouts were weakened.

## Verification

The old three-vital implementation fails the backlog/in-flight regression. The final hover-card gate passed 2 unit and 42 browser cases, with zero failures/flakes. The separate Workbench smoke passed all 11 cases, including equal vital baselines and F2 disclosure focus. Earlier affected-spec runs passed a11y, UX resilience, health, autoscaling and Inspector Live after the noted flow fixes; intermediate failures are preserved in tests/.output/workbench-step7-*.log.

All 2,602 tutorial unit cases passed, including 1,862 completion-sweep and 500 catalog cases. English and all 37 translations include Edit properties. Entry gzip9 remains 110,096 B, a 0 B delta from step 6. Golden updates remain reserved for step 12.

## Lesson routes

Five Live settings lessons now include translated guidance to open Edit properties, with matching coach targets and solution actions. One catalog message wraps each lesson's original goal and reuses the localized Live and Edit properties labels; it is translated and stamped in all 37 locales. Show-me property demos reveal the selected node's editing surface. Solutions open disclosures idempotently, preserving an already open section across lessons. Completion checks retain their original model and simulation criteria.

The full tutorial browser run found nine hidden-field flows and one transient startup failure. All ten passed targeted reruns after updating those flows and correcting scrolling. The four final cases passed together in 19.5 seconds; the catalog, runner and solution unit selection passed all 558 cases. These are in addition to the earlier 2,602-case tutorial unit sweep. Final full tutorial browser results are recorded in the delivery report.

Scroll snap now targets readout rows and section headings, rather than editable fields; snapping to a previous editable field could put Simulation below the footer. Existing tutorial clicks reproduced the defect and now pass without force, timeouts or assertion changes.

## Final tutorial sweep

The final full tutorial browser sweep passed 168 cases and exposed three additional assertions reading Inputs after a Show-me repair had intentionally opened Properties. Those flows now reopen Inputs before reading the same saved values; repair assertions remain unchanged. Every lesson solution and Skip-all path ran in the full sweep. The final targeted gate covers the three adjusted Inputs cases.
