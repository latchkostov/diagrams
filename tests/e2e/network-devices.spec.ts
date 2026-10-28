import { openLibrary, goToNode, waitForCameraIdle } from "./fixtures";
import { openLiveNodeDetails } from "./fixtures";
import { test, expect, gotoCanvas, gotoLive, expectNoErrors } from "./fixtures";

// On-prem network devices (docs/research/network-infrastructure.md): find a router by the model number people still
// say, see a device's throughput and capacity live, and a firewall's deny rule blocking traffic, shown apart from
// failures. Selectors are data-testid only. Uses the public example src/examples/branch-to-datacentre.json.

const SLUG = "branch-to-datacentre";

test.describe("network devices", () => {
  test("a Cisco router is found by its old model number and added with its size preset", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await openLibrary(page);
    const search = page.getByTestId("palette-search");
    await expect(search).toBeVisible();
    for (const q of ["3825", "ISR"]) {
      await search.fill(q);
      await expect(
        page
          .getByTestId("palette-results")
          .getByTestId(/^palette-item-/)
          .first(),
      ).toHaveAttribute("data-testid", "palette-item-cisco.isr");
    }
    await search.press("Enter");
    await expect(page.getByTestId("node-isr-1")).toBeVisible();

    // Its inspector: the branch preset (a Catalyst 8200, 1 Gbps) and what that means in messages.
    await page.getByTestId("inspector-section-node-simulation").click();
    await expect(page.getByTestId("inspector-field-size")).toHaveValue("branch");
    await expect(page.getByTestId("inspector-field-gbps")).toHaveAttribute("placeholder", "1");
    await expect(page.getByTestId("inspector-device-rate")).toContainText("About 2k messages/s per unit at 64 kB each");
    await page.getByTestId("inspector-field-size").selectOption("campus");
    await expect(page.getByTestId("inspector-field-gbps")).toHaveAttribute("placeholder", "18.9");
    await expect(page.getByTestId("inspector-device-rate")).toContainText("About 37k messages/s per unit");
    // High availability shows its units only when it's a pair or a cluster.
    await expect(page.getByTestId("inspector-field-replicas")).toHaveCount(0);
    await page.getByTestId("inspector-field-ha").selectOption("active-standby");
    await expect(page.getByTestId("inspector-field-replicas")).toHaveValue("2");
    await expect(page.getByTestId("inspector-field-failoverMs")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("live: a device shows its throughput, and its capacity against its datasheet ceiling", async ({
    page,
    consoleErrors,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
    await goToNode(page, "firewall");
    await expect(page.getByTestId("node-metric-firewall")).toBeVisible();
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-firewall").getAttribute("data-processed")))
      .toBeGreaterThan(0);

    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-panel")).toBeVisible();
    // A PA-3440 (20 Gbps with threat prevention) carries about 39k messages/s of 64 kB: 440/s is about 1%.
    const firewall = page.getByTestId("capacity-label-firewall");
    await expect(firewall).toHaveAttribute("data-level", "ok");
    await expect(firewall).toContainText("of 39k/s");
    // The branch's Catalyst 8200 (1 Gbps) carries about 2k/s.
    await expect(page.getByTestId("capacity-label-branch-router")).toContainText("of 2k/s");
    expectNoErrors(consoleErrors);
  });

  test("a firewall's deny rule blocks traffic, counted apart from failures", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("edge-label-firewall-spine-1").click();
    const rule = page.getByTestId("inspector-field-rule");
    await expect(rule).toBeVisible();
    await expect(page.getByTestId("inspector-field-rule-allow")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("inspector-field-rule-deny").click();
    await expect(page.getByTestId("inspector-field-rule-deny")).toHaveAttribute("aria-checked", "true");
    // The rule shows on the canvas too: a "no entry" glyph, not colour alone.
    await expect(page.getByTestId("edge-deny-firewall-spine-1")).toBeVisible();
    await expect(page.getByTestId("edge-firewall-spine-1")).toHaveAttribute("data-deny", "true");

    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await goToNode(page, "firewall");
    const blocked = page.getByTestId("node-blocked-firewall");
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText("blocked");
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-firewall").getAttribute("data-blocked")))
      .toBeGreaterThan(0);
    // Blocked isn't failed or dropped: no red count, and nothing reaches the spine behind the rule.
    const badge = page.getByTestId("node-badge-firewall");
    await expect(badge).toHaveAttribute("data-failed", "0");
    await expect(page.getByTestId("node-alert-firewall")).toHaveCount(0);
    await expect
      .poll(async () => Number(await page.getByTestId("node-badge-spine-2").getAttribute("data-processed")))
      .toBeGreaterThan(0);
    await expect(page.getByTestId("node-badge-spine-1")).toHaveAttribute("data-processed", "0");
    expectNoErrors(consoleErrors);
  });

  test("a deny rule is in the connection's accessible name", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("relationship-wrapper-firewall-payments")).toHaveAttribute(
      "aria-label",
      /deny rule: blocked/,
    );
    await expect(page.getByTestId("relationship-wrapper-firewall-spine-1")).not.toHaveAttribute("aria-label", /deny/);
  });

  test("device settings stay editable as custom properties where no control shows them", async ({ page }) => {
    // An ordinary gateway given a throughput keeps it in Custom properties, to see, change or remove.
    await gotoCanvas(page, "cell-based-bookings");
    await goToNode(page, "east-alb");
    await page.getByTestId("node-east-alb").click();
    await page.getByTestId("inspector-section-node-properties").click();
    await page.getByTestId("inspector-prop-new").fill("gbps");
    await page.getByTestId("inspector-prop-add").click();
    await expect(page.getByTestId("inspector-prop-remove-gbps")).toBeVisible();
    // A device's own section shows it instead.
    await gotoCanvas(page, SLUG);
    await page.getByTestId("node-firewall").click();
    await page.getByTestId("inspector-section-node-properties").click();
    await expect(page.getByTestId("inspector-prop-remove-ha")).toHaveCount(0);
    // A connection that isn't a firewall's has no rule control, so its deny stays a custom property.
    await goToNode(page, "web-1");
    await page.getByTestId("canvas-wrap").press("Shift+Digit2");
    await waitForCameraIdle(page);
    await page.getByTestId("edge-label-web-1-payments").click();
    await expect(page.getByTestId("inspector-field-rule")).toHaveCount(0);
    await page.getByTestId("inspector-section-edge-advanced").click();
    await page.getByTestId("inspector-prop-new").fill("deny");
    await page.getByTestId("inspector-prop-add").click();
    await expect(page.getByTestId("inspector-prop-remove-deny")).toBeVisible();
  });

  test("a failing-over pair says so legibly, and its hover breakdown names its units", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&sim=firewall-failover`);
    // Owner decision: Following preserves zoom; request readable device details explicitly.
    await goToNode(page, "firewall");
    await page.getByTestId("canvas-wrap").press("Shift+Digit2");
    await waitForCameraIdle(page);
    const chip = page.getByTestId("node-failover-firewall");
    await expect(chip).toBeVisible();
    const contrast = await chip.evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) throw new Error("Missing color context");
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((channel) => {
            const c = channel / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const fg = luminance(getComputedStyle(el).color);
      const bg = luminance(getComputedStyle(el).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId("node-firewall").hover();
    await openLiveNodeDetails(page, "firewall", "outcomes");
    await expect(page.getByTestId("node-detail-firewall")).toContainText("Active-standby pair");
  });

  test("the firewall rule is a named radio group with one Tab stop and arrow keys", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("edge-label-firewall-spine-1").click();
    const group = page.getByTestId("inspector-field-rule");
    await expect(group).toHaveAttribute("role", "radiogroup");
    await expect(group).toHaveAccessibleName("Firewall rule");
    const allow = page.getByTestId("inspector-field-rule-allow");
    const deny = page.getByTestId("inspector-field-rule-deny");
    await expect(allow).toHaveAttribute("tabindex", "0");
    await expect(deny).toHaveAttribute("tabindex", "-1");
    await allow.focus();
    await page.keyboard.press("ArrowRight");
    await expect(deny).toHaveAttribute("aria-checked", "true");
    await expect(deny).toBeFocused();
    await expect(page.getByTestId("edge-deny-firewall-spine-1")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(allow).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("edge-deny-firewall-spine-1")).toHaveCount(0);
  });

  test("a device keeps settings its controls don't show in custom properties, and out-of-range numbers are held to bounds", async ({
    page,
  }) => {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("node-firewall").click();
    // Health checks only have a control on a load balancer: on a firewall the setting stays a custom property.
    await page.getByTestId("inspector-section-node-properties").click();
    await page.getByTestId("inspector-prop-new").fill("healthChecks");
    await page.getByTestId("inspector-prop-add").click();
    await expect(page.getByTestId("inspector-prop-remove-healthChecks")).toBeVisible();
    // Bounds hold whatever is typed: a negative throughput becomes 0, a zero message size the smallest allowed.
    await page.getByTestId("inspector-section-node-simulation").click();
    const gbps = page.getByTestId("inspector-field-gbps");
    await gbps.fill("-1");
    await gbps.blur();
    await expect(gbps).toHaveValue("0");
    const kb = page.getByTestId("inspector-field-messageKB");
    await kb.fill("0");
    await kb.blur();
    await expect(kb).toHaveValue("0.01");
  });

  test("the event log's blocked label fits its column", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&sim=payments-denied`);
    // Owner decision: Live and Follow keep the camera, including a distant Overview zoom.
    await goToNode(page, "firewall");
    await page.getByTestId("canvas-wrap").press("Shift+Digit2");
    await waitForCameraIdle(page);
    await expect(page.getByTestId("node-blocked-firewall")).toBeVisible();
    await page.getByTestId("node-firewall").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.behaviour").click();
    await page.getByTestId("context-menu-item-sim.events").click();
    // The log keeps the latest events, so a block may have scrolled out: measure the column with its longest word.
    const kind = page.getByTestId("live-event-kind").first();
    await expect(kind).toBeVisible();
    expect(
      await kind.evaluate((el) => {
        el.textContent = "blocked";
        return el.scrollWidth <= el.clientWidth;
      }),
    ).toBe(true);
  });
});
