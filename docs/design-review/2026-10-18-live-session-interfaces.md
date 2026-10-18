## Live session interface review

The session state has an explicit home, separate from commands and recording.
Consumers accept named subsystem APIs and destructure the individual values they
use. No controls, copy, layout, interaction, accessibility or rendering change;
the chrome budget is unchanged.

### Identity and hook order

Compared TypeScript ASTs against `81674254`, matching functions across the file
move and the `useLiveSetup` to `useLiveSessionState` rename. All 69 dependency
lists (including the slow-motion layout effect without a dependency argument)
and every hook call's order are identical. All 69 complete effect, memo and
callback expressions, including their bodies, also match. The returned
LiveSession JSX is identical. A careful diff confirms each dependency refers to the same
individual value. Newly passed API objects never enter dependency arrays, so
they need no additional memoization.

| Function group                                                          | Dependency lists checked |
| ----------------------------------------------------------------------- | ------------------------ |
| LiveSession                                                             | 2                        |
| EditCapacity                                                            | 3                        |
| Capacity error / inputs / entry                                         | 1 / 8 / 1                |
| Frame loop                                                              | 7                        |
| Session state / bridge / panel layout                                   | 9 / 2 / 2                |
| Commands / recording                                                    | 7 / 3                    |
| Context menu                                                            | 3                        |
| Diagram changes / fixes                                                 | 3 / 5                    |
| Keyboard                                                                | 1                        |
| Trace spotlight / actions / slow motion / slow trace card / trace state | 6 / 2 / 2 / 1 / 1        |

### Interface sizes

Top-level inputs count named fields in an options object, or a positional value
as one. None of the session hooks exceeds ten.

| Hook                  | Inputs |
| --------------------- | ------ |
| useLiveSessionState   | 4      |
| useLiveSessionBridge  | 6      |
| useLivePanelLayout    | 4      |
| useLiveCommands       | 5      |
| useLiveRecordingState | 0      |
| useLiveRecording      | 3      |
| useTraceSpotlight     | 2      |
| useTraceActions       | 3      |
| useTraceSlowMotion    | 6      |
| useSlowTraceCard      | 1      |
| useTraceState         | 0      |
| useCapacityError      | 0      |
| useCapacityInputs     | 5      |
| useCapacityEntry      | 4      |
| useLiveDiagramChanges | 3      |
| useLiveFixes          | 10     |
| useLiveContextMenu    | 10     |
| useLiveKeyboard       | 6      |
| useFrameLoop          | 7      |

### Scope decisions

Kept the frame loop interface and its tests intact: its seven existing inputs
already fit the target. Rejected adding memoization or changing effect
dependencies, since both would broaden a pure interface refactor. No test
assertions or parity goldens are rewritten.
