## Overview, Focus and Follow

Edit opens with a complete Overview when it is readable, and a readable Focus otherwise. Focus frames the selection and its one-hop neighbourhood at 90–125%. Live names its camera mode in the transport; Follow centres the narrated subject at 90–100% on desktop. A manual move stays Custom until Follow is selected again. Existing fit and zoom control IDs remain on their actions.

Focus and Follow cull whole cards at the frame, pin off-frame neighbours at their own connection crossings, and slide colliding labels along their connections. Labels, cards, badges and particles use the endpoint rules from Round 6. Large views use icon tiles, screen-space names, a focus hint and clickable zone names. Text either clears the 10.5 px floor or collapses; enlarging it preserves authored card geometry.

Live dims grounds and borders while retaining readable text. Near connections retain full-opacity 2 px strokes, including idle and dashed paths. Background particles use 28% alpha; far views keep only near particles at reduced size and alpha. Request traffic has a shape-and-colour legend.

## Compatibility and scope

Live's fit and zoom controls now open from `live-view-menu`; Edit retains `canvas-controls`, `fit-view-button`, `zoom-in-button`, `zoom-out-button` and `view-tools-menu-button`. Camera journal compatibility remains, with `focusSelection` and `follow` added. Keyboard and overlap test flows account for the bottom-right control and the View menu's theme choices. Presentation still measures its own title card when it mounts.

The Round 6 decisions replace chevrons with pins. The undecided definition of main connections, dimming of other zones during zone focus, and camera movement from caption Details remain out of scope. Existing red badges continue to mean actual loss, not processed traffic. Typography and final visual tuning remain steps 12–13.

The production split check found the step-9 finding-order helper in the architecture-checks source path. Moving that presentation-only helper into the canvas layer preserves the established lazy boundary; no budget was raised.

## Verification and parity

Rendered checks sample actual PNG pixels on both public examples in both themes: near connection strokes clear 3:1, dimmed titles and second lines clear 4.5:1, and visible card text clears the size floor. Unit tests cover the camera policy, neighbourhood geometry, endpoint states, pins, collisions, text decisions and particle suppression. The text-floor negative control fails when sub-floor text is allowed again. The lazy frame layer has a held-chunk keyboard, cursor, export-policy and retry check.

No golden file changed. The full parity command reports intentional differences from the redesign: browser render and layout goldens change with the frame, camera and text treatment; image and HTML rendering fingerprints change with chrome and Live presentation; retry-storm metadata and i18n catalog differences are listed individually in the numbered-checks release fragment. Simulation outputs remain unchanged. The spec assigns golden recording to step 12, so these failures are reported rather than re-recorded here.

## Final validation record

The Linux load run passed 95 browser cases across five repeats with six workers and six CPUs, with zero failures or flakes; its associated unit set passed 1,373 tests. A separate five-repeat camera and Shift+3 run passed all 30 browser cases. The combined final tutorial and touched-module unit run passed 4,101 tests, with one existing skipped test. The production bundle split passed all 26 checks with both collaboration settings. The held FrameDetail chunk contract passed.

The full parity command reported 1,864 passing / nine failing Node tests and 13 passing / 97 failing browser tests: 3,168 goldens, 105 changed comparisons, none added, missing or stale. These are comparison results, not edited golden files. They remain for the step-12 review described above.

The first-visit tip now occupies a separate lane above the view controls and beside the minimap. Its overlap regression fails on the earlier production bundle. Light and dark captures of the three requested public-example states are saved outside the repository in the requested part-2 build folder.

The first full tutorial browser run passed 173 cases and found two hover solutions competing with narration-driven Follow. Their UI executor now chooses Overview before inspecting a node; lesson readout checks and hover assertions remain unchanged. The failed solutions are rerun explicitly. The last annotation-floor regression also checks that a far-view note keeps its tile while its words disappear.

A final test-ID audit updates Live Fit flows to open the transport menu, Live editing flows to open Edit properties, and keyboard exit to the persistent frame credit. Narration-resize checks now assert a readable title or an explicit off-frame pin at the zoom floor. This exposed and fixed a missing pin when the card title was culled but the connection endpoint remained inside the frame. The toolbar flyout opens above its measured anchor so it cannot cover its own collapse control. These compatibility changes preserve the control IDs and the underlying readout, fit, accessibility and resize checks.
