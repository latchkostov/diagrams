## Complete infrastructure imports stay compact after fitting settles

Large infrastructure imports now round the supporting-resource grid up to the available lane width and keep dependency targets on its existing 40 px gutter. The placement helper accepts an explicit vertical gap; existing callers retain their previous default. This removes an extra resource row and excess spacing when **Draw everything** includes policies and other supporting resources.

The browser regression now waits for the camera's measured refinement, then keeps the existing greater-than-110px readability assertion. Previously a fast Windows replay measured 114.12px before refinement and passed, while the settled view measured 107.85px and failed twice. The fixed settled view measures 111.48px in both Windows executions. Grid and gutter negative controls each fail when their fix is temporarily removed.

## Intentional output parity changes

- `node/imports/terraform-aws-plan.json`: only the Draw everything replay's node positions change. Supporting resources occupy five columns and two rows; four dependency targets move up 40px to match the grid gutter, and one target also shifts horizontally to stay clear. Import contents, relationships and reports remain unchanged.
- `node/imports/terraform-azure-state.json`: only the Draw everything replay's geometry changes. The billing boundary's support grid uses an additional column, reducing its height from 672 to 560px and increasing its width from 1380 to 1540px. The following shared boundary and its members move up 110px. Import contents, relationships and reports remain unchanged.
