/** True when the user asked the OS for less motion. CSS honours it globally; JS animations ask here. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** An animation duration that collapses to 0 (jump straight there) under reduced motion. */
export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
