## Workbench review fixes

Switching away from AI now stops microphone recognition, including pending permission/availability work, while keeping unfinished requests and replies. Keyboard navigation retains a visible rail tab stop and waits for culled canvas destinations. Phone Speed keeps its native keys, and narration navigation retains focus or hands it to Close at the final note.

Zoom to selection includes selected connection routes and labels. Frame detail uses the same routing options as connections, restores full paths on presentation, and suspends camera visibility, scaling and path mutations during image export. Unavailable Checks restores Properties. Ordinary presentation retains playback and the Live toggle.

## Intentional image golden changes

Only the following image golden families change, each in **light and dark**, as **SVG structure (`.svg.txt`) and PNG (`.png`)** under `tests/parity/goldens/browser/images/`:

| Example                    | Reason for all four files                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `branch-to-datacentre`     | Restore all 13 card titles and hidden connection labels; remove the camera's far-view stroke treatment and export the complete diagram. |
| `kafka-order-pipeline`     | Remove viewport-dependent font counter-scaling, card expansion and camera-only decoration from the exported diagram.                    |
| `aks-app-config-key-vault` | Restore authored font sizes and normal card detail instead of the camera's scaled/collapsed detail.                                     |
| `corpus-hand-shaped-lines` | Restore authored font sizes and card detail while keeping every saved custom bend.                                                      |

These 16 files previously recorded camera-dependent output. The correction intentionally restores complete diagram exports. Simulation, checks, routing, layout, file exports, Interactive HTML and language goldens must remain unchanged.
