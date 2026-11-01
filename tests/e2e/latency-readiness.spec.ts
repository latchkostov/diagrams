import type { Page } from "@playwright/test";
import { test, expect, openLiveNodeDetails } from "./fixtures";

for (const phase of ["pending", "animating", "idle"])
  test(`pinning Live details waits for focus-triggered movement (${phase} camera)`, async ({ page }) => {
    await page.setContent(`
      <div data-testid="canvas-wrap" data-camera-state="idle">
        <div class="react-flow__viewport" data-testid="test-viewport" style="transform:translate(0px, 0px) scale(1)"></div>
        <div tabindex="0"><div data-testid="node-billing">Billing</div></div>
      </div>
      <div data-testid="node-detail-billing" data-pinned="false">
        <strong data-testid="hover-full-name" data-clicks="0">Billing</strong>
        <button data-testid="hover-section-latency" aria-expanded="false">Latency</button>
      </div>`);
    await page.getByTestId("node-billing").evaluate((node, phase) => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
      const card = document.querySelector<HTMLElement>('[data-testid="node-detail-billing"]');
      const name = document.querySelector<HTMLElement>('[data-testid="hover-full-name"]');
      const row = document.querySelector<HTMLElement>('[data-testid="hover-section-latency"]');
      const viewport = document.querySelector<HTMLElement>('[data-testid="test-viewport"]');
      const anchor = node.parentElement;
      if (!canvas || !card || !name || !row || !viewport || !anchor) throw new Error("Missing focus-pan fixture");
      const final = "translate(0px, 0px) scale(1)";
      if (phase === "idle") {
        // A pan outside the camera controller can still be moving. Model successive
        // rendered transforms while the card itself keeps a constant box.
        const positions = ["translate(0px, -100px) scale(1)", "translate(0px, -50px) scale(1)", final];
        Object.defineProperty(viewport.style, "transform", { get: () => positions.shift() ?? final });
      }
      anchor.addEventListener("focus", () => (canvas.dataset.cameraState = phase));
      name.addEventListener("click", () => {
        name.dataset.clicks = String(Number(name.dataset.clicks) + 1);
        name.dataset.ready = String(canvas.dataset.cameraState === "idle" && viewport.style.transform === final);
        card.dataset.pinned = "true";
      });
      row.addEventListener("click", () => row.setAttribute("aria-expanded", "true"));
    }, phase);
    let cameraRead!: () => void;
    const reachedCamera = new Promise<"camera">((resolve) => (cameraRead = () => resolve("camera")));
    // Observe the driver's real readiness request, keeping the card stationary throughout
    // the held pan. Stable card geometry alone cannot acknowledge pending camera work.
    const driver = new Proxy(page, {
      get(target, key, receiver) {
        if (key === "getByTestId")
          return (...args: Parameters<Page["getByTestId"]>) => {
            if (args[0] === "canvas-wrap") cameraRead();
            return target.getByTestId(...args);
          };
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const opening = openLiveNodeDetails(driver, "billing", "latency", { settleCamera: true });
    try {
      expect(await Promise.race([reachedCamera, opening.then(() => "pinned")])).toBe("camera");
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-camera-state", phase);
      await expect(page.getByTestId("hover-full-name")).toHaveAttribute("data-clicks", "0");
      await page.getByTestId("canvas-wrap").evaluate((canvas) => (canvas.dataset.cameraState = "idle"));
      await opening;
      await expect(page.getByTestId("node-detail-billing")).toHaveAttribute("data-pinned", "true");
      await expect(page.getByTestId("hover-full-name")).toHaveAttribute("data-ready", "true");
      await expect(page.getByTestId("hover-section-latency")).toHaveAttribute("aria-expanded", "true");
    } finally {
      await page.getByTestId("canvas-wrap").evaluate((canvas) => (canvas.dataset.cameraState = "idle"));
      await opening;
    }
  });

test("ordinary Live details can pin with unrelated camera and pane work pending", async ({ page }) => {
  await page.setContent(`
    <div data-testid="canvas-wrap" data-camera-state="pending" data-pane-pending="true">
      <div tabindex="0"><div data-testid="node-orders">Orders</div></div>
    </div>
    <div data-testid="node-detail-orders" data-pinned="false">
      <strong data-testid="hover-full-name">Orders</strong>
      <button data-testid="hover-section-planning" aria-expanded="false">Planning</button>
    </div>`);
  await page.getByTestId("hover-full-name").evaluate((name) => {
    name.addEventListener("click", () => name.parentElement?.setAttribute("data-pinned", "true"));
  });
  await page.getByTestId("hover-section-planning").evaluate((row) => {
    row.addEventListener("click", () => row.setAttribute("aria-expanded", "true"));
  });
  await openLiveNodeDetails(page, "orders", "planning");
  await expect(page.getByTestId("node-detail-orders")).toHaveAttribute("data-pinned", "true");
  await expect(page.getByTestId("hover-section-planning")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-camera-state", "pending");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-pane-pending", "true");
});
