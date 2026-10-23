import type { Page } from "@playwright/test";
import { test, expect, openMissingDlq, expectNoErrors } from "./fixtures";
import { callTool, installFakeModelContext, must, nodeCount, toolNames } from "./ai-helpers";

// Architecture checks for agents: check_diagram (read-only) through a fake document.modelContext. A finding's
// fix is edit_diagram ops, so applying it is an ordinary agent turn with Undo. Selectors are data-testid only.

// The diagram: openMissingDlq (one dead-letter warning, two suggestions; tests/fixtures/checks/service-bus-missing-dlq.diagram.json).

interface Report {
  findings: {
    id: string;
    severity: string;
    title: string;
    targets: string[];
    fix?: { label: string; ops?: object[] };
  }[];
  summary: string;
}
const check = async (page: Page, input: object = {}) => {
  const res = await callTool(page, "check_diagram", input);
  expect(res.isError).toBe(false);
  return JSON.parse(res.text) as Report;
};

test("check_diagram finds the missing dead-letter queue; its fix is one undoable edit_diagram turn", async ({
  page,
  consoleErrors,
}) => {
  await installFakeModelContext(page);
  await openMissingDlq(page);
  await expect(page.getByTestId("node-posting-sub")).toBeVisible();
  await expect.poll(() => toolNames(page)).toContain("check_diagram");

  const report = await check(page);
  expect(report.summary).toBe("1 warning, 2 suggestions.");
  const [first] = report.findings;
  expect(first).toMatchObject({
    id: "dead-letter:posting-sub",
    severity: "warning",
    title: "Failed messages are dropped",
    targets: ["posting-sub", "worker"],
    fix: { label: "Add dead-letter queue" },
  });
  expect((await check(page, { include: "warnings" })).findings.map((f) => f.id)).toEqual(["dead-letter:posting-sub"]);

  // Checking changes nothing.
  const before = await nodeCount(page);
  expect(await page.getByTestId("toast").count()).toBe(0);

  const applied = await callTool(page, "edit_diagram", {
    ops: must(first.fix, "a fix").ops,
    summary: "Added a dead-letter queue",
  });
  expect(applied.isError).toBe(false);
  expect(JSON.parse(applied.text)).toMatchObject({ ok: true, summary: "+1 node, +1 connection" });
  await expect.poll(() => nodeCount(page)).toBe(before + 1);
  await expect(page.getByTestId("toast")).toContainText("AI: +1 node, +1 connection");
  const after = await check(page);
  expect(after.findings.map((f) => f.id)).not.toContain("dead-letter:posting-sub");
  expect(after.summary).toBe("0 warnings, 3 suggestions.");

  // One undo step takes the fix back, and the warning with it.
  await page.getByTestId("ai-toast-undo").click();
  await expect.poll(() => nodeCount(page)).toBe(before);
  expect((await check(page)).findings[0].id).toBe("dead-letter:posting-sub");
  expectNoErrors(consoleErrors);
});

test("live view offers check_diagram too", async ({ page }) => {
  await installFakeModelContext(page);
  await openMissingDlq(page);
  await expect(page.getByTestId("node-posting-sub")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await expect.poll(() => toolNames(page)).toEqual(["check_diagram", "describe_diagram", "get_share_link"]);
  expect((await check(page, { rules: ["dead-letter"] })).summary).toBe("1 warning, 1 suggestion.");
});

test("the file's ignores hold, and a private diagram offers no check_diagram", async ({ page, consoleErrors }) => {
  await installFakeModelContext(page);
  await openMissingDlq(page);
  const diagram = {
    format: "diagrams/v1",
    title: "Ledger intake",
    nodes: [
      { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
      { id: "ledger-q", stencil: "aws.sqs", label: "ledger", x: 320, y: 0 },
      { id: "poster", stencil: "aws.lambda", label: "Ledger poster", x: 640, y: 0, props: { failureRate: 0.1 } },
    ],
    edges: [
      { id: "e1", from: "intake", to: "ledger-q", kind: "async" },
      { id: "e2", from: "ledger-q", to: "poster", kind: "async" },
    ],
    checks: { ignore: [{ rule: "dead-letter", target: "ledger-q", reason: "Redrive is in the platform module" }] },
  };
  await page.getByTestId("import-input").setInputFiles({
    name: "ledger.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diagram)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Ledger intake");
  await expect.poll(() => toolNames(page)).toContain("check_diagram");
  // The message-loop rule is included even when this acyclic diagram has no finding from it.
  expect(await check(page)).toEqual({ findings: [], summary: "Nothing to check. 14 checks ran; 1 ignored." });

  // File ▸ Privacy ▸ Private diagram: every AI tool goes, check_diagram included.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await expect.poll(() => toolNames(page)).toEqual([]);
  expectNoErrors(consoleErrors);
});
