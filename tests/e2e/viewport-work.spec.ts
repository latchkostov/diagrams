import { eventPipeline } from "../../src/bench/workloads/pipeline";
import { test, expect, gotoCanvas, gotoLive, pauseClock, waitForCameraIdle, goToNode } from "./fixtures";
import { expectFittedIdentity, zoomIdentity } from "./node-identity";

for (const live of [false, true])
  test(`an off-screen card enters fully named in the held pan frame (${live ? "Live" : "Edit"})`, async ({ page }) => {
    const diagram = eventPipeline(192);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      (diagram) => localStorage.setItem("diagrams.imported.v1", JSON.stringify(diagram)),
      diagram,
    );
    await page.clock.install();
    if (live) await gotoLive(page, "./?view=canvas&example=imported&live=1&sim=incident&paused=1");
    else await gotoCanvas(page, "imported");
    await zoomIdentity(page, 0.8);
    await waitForCameraIdle(page);
    await pauseClock(page);
    const root = page.getByTestId("canvas-wrap");
    // DOM and the accessible names remain complete, including parts several screens away.
    await expect(page.getByTestId(/^rf__node-/)).toHaveCount(diagram.nodes.length + diagram.groups.length);
    const tree = await root.ariaSnapshot();
    expect(diagram.nodes.filter((node) => !tree.includes(node.label)).map((node) => node.label)).toEqual([]);
    const timeline = diagram.simulations?.find((s) => s.id === "incident")?.timeline;
    if (!timeline) throw new Error("Missing incident timeline");
    const target = await root.evaluate(
      (root, ids) => {
        const pane = root.getBoundingClientRect();
        const choices = ids.map((id) => {
          const el = root.querySelector(`[data-testid="rf__node-${id}"]`);
          if (!el) throw new Error(`Missing card ${id}`);
          const box = el.getBoundingClientRect();
          return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        return choices.sort(
          (a, b) => Math.hypot(b.x - pane.x, b.y - pane.y) - Math.hypot(a.x - pane.x, a.y - pane.y),
        )[0];
      },
      live
        ? timeline.flatMap((step) =>
            step.action.do === "status" && step.action.status === "down" ? [step.action.node] : [],
          )
        : diagram.nodes.map((n) => n.id),
    );
    const pane = page.getByTestId("canvas-pane");
    const bounds = await pane.boundingBox();
    if (!bounds) throw new Error("Missing pane");
    const dx = target.x - bounds.x - bounds.width / 2;
    const dy = target.y - bounds.y - bounds.height / 2;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(bounds.width);
    if (live) {
      await expect(page.getByTestId(`rf__node-${target.id}`)).toHaveAttribute("data-live-status", "up");
      // Seek past the incident's worker outage while this card is still off screen.
      await page.getByTestId("live-timeline-input").evaluate((el) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!set) throw new Error("Missing input setter");
        set.call(el, "220");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await page.clock.runFor(256);
      await expect(page.getByTestId(`rf__node-${target.id}`)).toHaveAttribute("data-live-status", "down");
    }
    await pane.dispatchEvent("wheel", { deltaX: dx, deltaY: dy, bubbles: true });
    // Exactly one frame: no polling that advances the clock or a settle timeout can hide blank ink.
    await page.clock.runFor(16);
    const subject = diagram.nodes.find((n) => n.id === target.id);
    if (!subject) throw new Error("Missing subject");
    await expectFittedIdentity(page, target.id, subject.label);
    if (live) {
      await expect(page.getByTestId(`rf__node-${target.id}`)).toHaveAttribute("data-live-status", "down");
    }
    await page.clock.resume();
    await waitForCameraIdle(page);
    // Find and zoom-to-selection still reach a different, off-screen part.
    const other = diagram.nodes.find((n) => n.id !== target.id);
    if (!other) throw new Error("Missing other card");
    await goToNode(page, other.id);
    await page.keyboard.press("Shift+2");
    await waitForCameraIdle(page);
    await expectFittedIdentity(page, other.id, other.label);
  });
