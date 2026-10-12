// "Try the on-device model" (Advanced): whether the AI panel shows its request box for Chrome's built-in
// model. Off by default until the evals (docs/research/on-device-model.md) clear the bar; remembered.

const KEY = "diagrams.ai-ondevice.v1";

/** Flip once the eval pass rate is good enough to offer the box without asking. */
export const ON_DEVICE_DEFAULT = false;

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
