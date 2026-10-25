## Boundary naming and validation follow-up

Creating a boundary keeps its automatic Label focus and immediate typing, including while the inspector
downloads. Graph membership now reaches the focus controller before the inspector requests its field.
Peer deletion still cancels a pending rename without disturbing a new annotation's editor.

Simulation property choices and field diagnostics share typed descriptors with bounds from the model schema.
Regression tests assert each traffic field's complete diagnostic and limit, including both ramp stage fields
and both spike rates, and verify repaired values clear their errors. No parity goldens changed.
