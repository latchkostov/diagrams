## Inspector text editing and autoscaling

The existing Simulation and Advanced controls retain their source binding and policy readouts while
text fields have focus. No controls or chrome were added. Regression coverage exercises all three text
fields with KEDA and label edits with ECS ALB and Container Apps event bindings, alongside positive
render-counter assertions and the existing per-key render limits.
