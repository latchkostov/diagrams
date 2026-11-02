import { test, expect } from "./fixtures";
import { focus } from "./keyboard-tutorial-driver";

for (const direction of ["forward", "backward"]) {
  test(`keyboard field navigation stays in the Inspector when moving ${direction}`, async ({ page }) => {
    await page.setContent(`
    <div data-testid="canvas-wrap" data-camera-state="idle" data-interaction-state="idle">
      <button data-testid="rf__node-client" data-id="client">Client</button>
    </div>
    <aside data-testid="inspector" data-canvas-entries="0">
      <input data-testid="inspector-field-label" value="API">
      ${Array.from({ length: 6 }, (_, i) => `<button data-testid="field-${i}">Field ${i}</button>`).join("")}
      <button data-testid="inspector-section-node-simulation">Simulation</button>
    </aside>
  `);
    const inspector = page.getByTestId("inspector");
    await page.getByTestId("rf__node-client").evaluate((el) => {
      el.addEventListener("focus", () => {
        const inspector = document.querySelector<HTMLElement>('[data-testid="inspector"]');
        if (!inspector) throw new Error("Missing Inspector");
        inspector.dataset.canvasEntries = String(Number(inspector.dataset.canvasEntries) + 1);
      });
    });
    const first = "inspector-field-label";
    const last = "inspector-section-node-simulation";
    await page.getByTestId(direction === "forward" ? first : last).focus();
    const destination = direction === "forward" ? last : first;
    await focus(page, destination);
    await expect(page.getByTestId(destination)).toBeFocused();
    // Entering a canvas node also changes selection, replacing the Inspector's fields.
    await expect(inspector).toHaveAttribute("data-canvas-entries", "0");
  });
}
