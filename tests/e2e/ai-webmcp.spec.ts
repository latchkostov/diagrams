import { test, expect, gotoCanvas, gotoGallery, expectNoErrors, savedDiagram } from "./fixtures";
import { SLUG, callTool, must, installFakeModelContext, nodeCount, openAdvanced, toolNames } from "./ai-helpers";

// WebMCP: a fake document.modelContext (installed before the app loads) records registerTool, so the
// test can call the tools the way a browsing agent would. Selectors are data-testid only.

const ALL = [
  "check_diagram",
  "describe_diagram",
  "edit_diagram",
  "find_stencils",
  "get_share_link",
  "new_diagram",
  "set_simulation",
];

test.describe("WebMCP tools", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await expect.poll(() => toolNames(page)).toEqual(ALL);
  });

  test("registers the seven tools with their annotations, once (StrictMode-safe)", async ({ page, consoleErrors }) => {
    const annotations = await page.evaluate(() =>
      (window as unknown as { __mcp: { annotations(): Record<string, object> } }).__mcp.annotations(),
    );
    expect(annotations).toEqual({
      describe_diagram: { readOnlyHint: true, untrustedContentHint: true },
      check_diagram: { readOnlyHint: true, untrustedContentHint: true },
      find_stencils: { readOnlyHint: true },
      edit_diagram: { untrustedContentHint: true },
      set_simulation: {},
      new_diagram: { consequentialHint: true },
      get_share_link: { readOnlyHint: true },
    });
    expectNoErrors(consoleErrors);
  });

  test("describe_diagram, then edit_diagram changes the diagram as one undo step", async ({ page, consoleErrors }) => {
    const described = await callTool(page, "describe_diagram");
    expect(described.isError).toBe(false);
    expect(described.text).toContain("payments");
    expect(described.text).toContain('"');

    const before = await nodeCount(page);
    const res = await callTool(page, "edit_diagram", {
      ops: [
        { op: "add_node", kind: ".NET consumer", label: "billing-worker", key: "w" },
        { op: "add_node", kind: "PostgreSQL", label: "billing-db", key: "db" },
        { op: "connect", from: "payments", to: "w" },
        { op: "connect", from: "w", to: "db", kind: "sync" },
      ],
    });
    expect(res.isError).toBe(false);
    const body = JSON.parse(res.text) as {
      ok: boolean;
      summary: string;
      results: { op: string; id?: string; stencil?: { id: string } }[];
    };
    expect(body).toMatchObject({ ok: true, summary: "+2 nodes, +2 connections" });
    const worker = must(
      body.results.find((r) => r.op === "add_node" && r.stencil?.id === "service.dotnet"),
      "the worker",
    );
    expect(worker.id).toBeTruthy();
    await expect(page.getByTestId(`node-${worker.id}`)).toBeVisible();
    expect(await nodeCount(page)).toBe(before + 2);
    await expect(page.getByTestId("toast")).toContainText("AI: +2 nodes, +2 connections");

    // The diagram now reads back with the new node.
    expect((await callTool(page, "describe_diagram")).text).toContain("billing-worker");

    // One undo step takes the whole call back.
    await page.getByTestId("ai-toast-undo").click();
    await expect.poll(() => nodeCount(page)).toBe(before);
    await expect(page.getByTestId(`node-${worker.id}`)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a failing edit applies nothing and returns candidates; dryRun changes nothing", async ({ page }) => {
    const before = await nodeCount(page);
    const bad = await callTool(page, "edit_diagram", { ops: [{ op: "remove", targets: ["Payment"] }] });
    expect(bad.isError).toBe(true);
    const body = JSON.parse(bad.text) as { ok: boolean; candidates?: { id: string }[] };
    expect(body.ok).toBe(false);
    expect(body.candidates?.map((c) => c.id)).toContain("payments");
    const dry = await callTool(page, "edit_diagram", {
      ops: [{ op: "add_node", kind: "Kafka topic", label: "x" }],
      dryRun: true,
    });
    expect(JSON.parse(dry.text)).toMatchObject({ ok: true, dryRun: true });
    expect(await nodeCount(page)).toBe(before);
  });

  test("stencil default names and inferred agent dependencies share one undo step", async ({ page, consoleErrors }) => {
    const added = await callTool(page, "edit_diagram", {
      ops: [{ op: "add_node", kind: "generic.service", label: "Service" }],
    });
    expect(added.isError).toBe(false);
    const { results } = JSON.parse(added.text) as { results: { id: string }[] };
    const id = results[0].id;
    const node = page.getByTestId(`node-${id}`);
    await expect(node).toContainText("Service");

    const changed = await callTool(page, "edit_diagram", {
      ops: [
        { op: "update", target: id, kind: "azure.key-vault" },
        { op: "connect", from: "payments", to: id },
        { op: "connect", from: "payments", to: id, relation: "config" },
        { op: "connect", from: "payments", to: id, relation: "flow", kind: "sync" },
      ],
    });
    expect(changed.isError).toBe(false);
    await expect(node).toContainText("Key Vault");
    await expect
      .poll(async () => {
        const d = await savedDiagram(page);
        const n = d.nodes.find((n) => n.id === id);
        return {
          node: { stencil: n?.stencil, label: n?.label },
          relations: d.edges.filter((e) => e.to === id).map((e) => e.relation),
        };
      })
      .toEqual({
        node: { stencil: "azure.key-vault", label: "Key Vault" },
        relations: ["secret", "config", undefined],
      });

    await page.getByTestId("ai-toast-undo").click();
    await expect(node).toContainText("Service");
    await expect
      .poll(async () => {
        const d = await savedDiagram(page);
        const n = d.nodes.find((n) => n.id === id);
        return { stencil: n?.stencil, label: n?.label, edges: d.edges.filter((e) => e.to === id) };
      })
      .toEqual({ stencil: "generic.service", label: "Service", edges: [] });

    // The inspector uses the same model change as the agent.
    await node.dblclick();
    await page.getByTestId("inspector-field-stencil").click();
    await page.getByTestId("stencil-picker-search").fill("postgres");
    await page.getByTestId("context-menu-item-pick-stencil:postgres").click();
    await expect(node).toContainText("PostgreSQL");
    await expect
      .poll(async () => {
        const n = (await savedDiagram(page)).nodes.find((n) => n.id === id);
        return { stencil: n?.stencil, label: n?.label };
      })
      .toEqual({ stencil: "postgres", label: "PostgreSQL" });
    expectNoErrors(consoleErrors);
  });

  test("find_stencils, set_simulation and get_share_link", async ({ page }) => {
    const found = JSON.parse((await callTool(page, "find_stencils", { query: "service bus queue" })).text) as {
      id: string;
    }[];
    expect(found[0].id).toBe("azure.service-bus.queue");

    const sim = await callTool(page, "set_simulation", {
      title: "Agent peak",
      traffic: [{ from: "shopper", pattern: "constant", ratePerSec: 200, durationSec: 30 }],
      events: [{ atSec: 10, node: "payments", do: "down" }],
    });
    expect(sim.isError).toBe(false);
    expect(JSON.parse(sim.text)).toMatchObject({ ok: true, title: "Agent peak" });
    expect((await callTool(page, "describe_diagram")).text).toContain("Agent peak");

    const link = JSON.parse((await callTool(page, "get_share_link")).text) as { url: string; length: number };
    expect(link.url).toMatch(/#d=[A-Za-z0-9_-]+$/);
    expect(link.length).toBe(link.url.length);
  });

  test("new_diagram opens a blank diagram with the given title", async ({ page }) => {
    const res = JSON.parse((await callTool(page, "new_diagram", { title: "Agent sketch" })).text);
    expect(res).toMatchObject({ ok: true, title: "Agent sketch" });
    await expect(page.getByTestId("node-payments")).toHaveCount(0);
    await expect(page.getByTestId("diagram-title")).toHaveText("Agent sketch");
    await expect.poll(() => toolNames(page)).toEqual(ALL);
    const edit = await callTool(page, "edit_diagram", {
      ops: [{ op: "add_node", kind: "Kafka topic", label: "orders" }],
    });
    expect(edit.isError).toBe(false);
    await expect.poll(() => nodeCount(page)).toBe(1);
  });

  test("live view offers only reading, checking and sharing; other views offer nothing", async ({ page }) => {
    await page.getByTestId("live-toggle").click();
    await expect.poll(() => toolNames(page)).toEqual(["check_diagram", "describe_diagram", "get_share_link"]);
    await page.getByTestId("live-toggle").click();
    await expect.poll(() => toolNames(page)).toEqual(ALL);
    await page.getByTestId("view-gallery").click();
    await expect.poll(() => toolNames(page)).toEqual([]);
  });
});

test("without document.modelContext nothing registers, errors or shows", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await expect(page.getByTestId("node-payments")).toBeVisible();
  expect(await page.evaluate(() => "modelContext" in document || "modelContext" in navigator)).toBe(false);
  await openAdvanced(page);
  await page.getByTestId("ai-collapse").click();
  await expect(page.getByTestId("ai-rail")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("live-toggle").click();
  await gotoGallery(page);
  expectNoErrors(consoleErrors);
});

test("tools aren't offered in the embed viewer", async ({ page }) => {
  await installFakeModelContext(page);
  await page.goto(`./?embed=1&example=${SLUG}`);
  await page.waitForLoadState("networkidle");
  expect(await toolNames(page)).toEqual([]);
});
