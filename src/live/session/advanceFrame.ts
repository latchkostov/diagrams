import type { LiveController } from "../controller";
import type { FrameClock } from "../frameClock";

/** Sample engine cost only when an advance moves simulated time, retaining the estimate while live waits. */
export function advanceFrame(controller: LiveController, clock: FrameClock, wallMs: number): void {
  const before = controller.snapshot().time;
  const engine = performance.now();
  controller.advance(wallMs);
  const engineMs = performance.now() - engine;
  if (controller.snapshot().time > before) clock.spent(wallMs, engineMs);
}
