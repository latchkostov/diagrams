// "Try the on-device model" (Advanced): whether the AI panel shows its request box for Chrome's built-in
// model. On by default since round 3, at the owner's direction (the 80% bar reached by projection, not a
// measured run yet: docs/research/on-device-model.md); turning it off is remembered.

const KEY = "diagrams.ai-ondevice.v1";

/** On where the model can run; Advanced turns it off. */
export const ON_DEVICE_DEFAULT = true;

export function readOnDevice(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? ON_DEVICE_DEFAULT : v === "1";
  } catch {
    return ON_DEVICE_DEFAULT;
  }
}

export function rememberOnDevice(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: it lasts for this visit.
  }
}
