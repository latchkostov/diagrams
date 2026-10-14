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
});
