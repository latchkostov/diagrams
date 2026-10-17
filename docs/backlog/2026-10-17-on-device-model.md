## On-device model

- Run the on-device evals (`?view=lab&preset=ondevice-evals` on `pnpm dev`, see `docs/research/on-device-model.md`) in a
  Chrome with the model and record the rate. The box is on by default since round 3 (the 80% bar reached by
  projection only): if a measured run falls short, decide whether to turn `ON_DEVICE_DEFAULT` back off.
- Live view: scenario requests as simulations (`set_simulation`) need their own prompt and eval cases.
- Boundaries and notes aren't in the on-device op format yet.
