import type { Page, TestInfo } from "@playwright/test";
import {
  expect,
  openMissingDlq,
  openCheckFinding,
  pageLoadTimeout,
  TEXT_END,
  pauseClock,
  waitForCameraIdle,
  waitForHistoryIdle,
  waitForAutosave,
  waitForChecks,
} from "./fixtures";
import { typingWork, median } from "./typing-work";
import { installChecksMeasurement } from "./checks-measurement";
import { installCheckNotifications, waitForCheckCompletion } from "./checks-notifications";
import { RENDER_HOOK } from "../bench/ui/instrument";

type Renders = ReturnType<NonNullable<Window["__benchRenders"]>["stop"]>;

const LONG = "Node 0.12, renamed to something wider than any card";

/** The page's check-run counts and switch (dev and e2e builds: `window.__checks`, src/canvas/checks/useChecks.ts). */
type CheckRunStats = {
  started: number;
  finished: number;
  held: boolean;
  skipped: number;
  pending(): boolean;
  flush(): void;
};
const runStats = (page: Page) =>
  page.evaluate(() => {
    const stats = (window as unknown as { __checks: CheckRunStats }).__checks;
    return {
      started: stats.started,
      finished: stats.finished,
      held: stats.held,
      skipped: stats.skipped,
      pending: stats.pending(),
      nativeChecks: window.__checkResults.nativeChecks,
      cacheHits: window.__checkResults.cacheHits,
      workerFailures: window.__checkResults.workerFailures,
    };
  });
const holdChecks = (page: Page, held: boolean) =>
  page.evaluate((h) => void ((window as unknown as { __checks: CheckRunStats }).__checks.held = h), held);

export async function checksTyping(page: Page, info: TestInfo, measureCpu = false) {
  const controlled = !measureCpu;
  if (controlled) await page.clock.install();
  // A worker may finish before the sample's two paints, especially under uneven CPU load.
  // Queue its result until the input reading is taken: publishing findings belongs after the sample
  // in both modes. The real worker still computes, and posting/copying stays inside the sample.
  await page.addInitScript(installChecksMeasurement);
  if (!measureCpu) await page.addInitScript(RENDER_HOOK);
  // 1,500 nodes in 100 pipelines, each with a loop of requests: every check runs, and capacity's fixed point
  // runs to its bound (the slowest case), in the worker.
  const nodes: object[] = [];
  const edges: object[] = [];
  for (let p = 0; p < 100; p++)
    for (let i = 0; i < 15; i++) {
      const id = `p${p}n${i}`;
      const stencil = i === 0 ? "client.browser" : i % 3 === 1 ? "aws.sqs" : "service.go";
      nodes.push({ id, stencil, label: `Node ${p}.${i}`, x: i * 260, y: p * 120 });
      if (i) edges.push({ id: `e-${id}`, from: `p${p}n${i - 1}`, to: id, kind: i >= 12 ? "sync" : "async" });
      if (i === 14) edges.push({ id: `b-${id}`, from: id, to: `p${p}n11`, kind: "sync" });
    }
  const diagram = { format: "diagrams/v1", title: "Large", nodes, edges };
  await openMissingDlq(page);
  await page.getByTestId("import-input").setInputFiles({
    name: "large.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diagram)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Large", { timeout: pageLoadTimeout() });
  // The previous document already has a warning. Wait for this fixture's 100 request
  // cycles and one aggregate capacity warning, not that document's still-visible count.
  await expect(page.getByTestId("checks-count").getByTestId("checks-warning-text")).toHaveText("101 warnings", {
    timeout: 60_000,
  });

  // Select a node through its finding (the diagram is far bigger than the view), then close the card.
  await page.getByTestId("checks-count").click();
  await expect(page.getByTestId("checks-card")).toBeVisible();
  await openCheckFinding(page, "sync-cycle:p0n11");
  await page.getByTestId("check-element-p0n12").first().click();
  await page.getByTestId("dock-tab-properties").click();
  const label = page.getByTestId("inspector-field-label");
  await expect(label).toHaveValue("Node 0.12");
  // A name already wider than a card can grow: typing on doesn't resize the node and re-route its edges, a
  // cost of its own (several times a keystroke's) that would land in whichever phase crosses the width.
  await label.fill(LONG);
  await label.press(TEXT_END);
  await expect(page.getByTestId("planning-unavailable")).toBeVisible();
  const planningBefore = await page.evaluate(() => ({
    ...(window as unknown as { __planning: { reads: number; analyses: number; explanations: number } }).__planning,
  }));
  expect(planningBefore.reads, "oversize planning never copies the editor document").toBe(0);
  // Opt-in throttling for an investigation, independent of the operation assertions.
  if (process.env.CHECKS_CPU) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CHECKS_CPU) });
  }

  if (controlled) {
    await waitForCameraIdle(page);
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    // History and autosave can settle before the checks debounce. Freezing that timer would
    // strand prepare(LONG): the label already matches, so it makes no edit and flushes no run.
    // Exercise that boundary on every run: queue a setup edit with its debounce frozen,
    // then let the checks-state wait drain it before freezing the measurement clock.
    await pauseClock(page);
    await label.fill(`${LONG} setup`);
    await label.fill(LONG);
    await page.clock.resume();
    await waitForChecks(page);
    await pauseClock(page);
  }
  // Operation counts use the same idle handoff and two final virtual frames in both modes. An asynchronous worker
  // handoff must not let the 300/350 ms autosave/history timers enter only one sample.
  const painted = () =>
    controlled
      ? page.clock.runFor(32)
      : page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const work = await typingWork(page, measureCpu, controlled ? painted : undefined);

  // Each check run as it comes due (started, or held back), told at once: `started` and `skipped` become setters
  // that call out to the test before the run goes on. (A poll couldn't hear of a run on the main thread until it
  // had finished, and the next key would never meet it.)
  let onDue = () => {};
  let onSettled = () => {};
  await page.exposeFunction("__checkDue", () => onDue());
  if (controlled) await page.exposeFunction("__checkSettled", () => onSettled());
  await page.evaluate(installCheckNotifications, controlled);
  /** Resolves when the next run comes due; a backstop at the scale of the first run's wait, for a run that never does. */
  const nextDue = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      new Promise<void>((resolve) => (onDue = resolve)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no check run came due")), 60_000);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  const findings = page.getByTestId("inspector-findings");
  // This test measures the work when a run starts, not the debounce's quiet time (the scheduler's unit
  // tests cover that). Start the scheduled idle callback explicitly, without paying 400 ms for every
  // unmeasured prefix restoration. A run that already started on a busy machine is never queued twice.
  const flush = async (before: { started: number; skipped: number }) => {
    await page.evaluate((count) => {
      const stats = (window as unknown as { __checks: CheckRunStats }).__checks;
      if (stats.started + stats.skipped === count) stats.flush();
    }, before.started + before.skipped);
    // Playwright's controlled idle callback runs after 50 ms when edit timers are pending.
    // Advance four clock frames, then await the scheduler's actual start signal below.
    if (controlled) await page.clock.runFor(64);
  };
  // Completion messages follow the scheduler's cleanup without accumulating polling delays over 42 samples.
  // The CPU benchmark retains its existing wait outside the sample.
  const finished = controlled
    ? () =>
        waitForCheckCompletion(
          async () => (await runStats(page)).pending,
          () => new Promise<void>((resolve) => (onSettled = resolve)),
        )
    : () => expect.poll(async () => (await runStats(page)).pending).toBe(false);
  const scheduled = () => expect.poll(async () => (await runStats(page)).pending).toBe(true);

  /** Restore the exact input and fresh findings before either member of a pair. */
  async function prepare(text: string, restoring = false) {
    await holdChecks(page, false);
    const before = await runStats(page);
    if ((await label.inputValue()) !== text) {
      const due = nextDue();
      await page.evaluate((value) => (window.__checkResults.restoring = value), restoring);
      try {
        await label.fill(text);
        await label.press(TEXT_END);
        if (controlled) await scheduled();
        await flush(before);
        await due;
      } finally {
        await page.evaluate(() => (window.__checkResults.restoring = false));
      }
    }
    await finished();
    await painted();
    if (controlled) {
      // Finish background edit work before starting either member of the next pair.
      await page.clock.runFor(400);
      await waitForHistoryIdle(page);
      await waitForAutosave(page);
      await painted();
    }
    await expect(label).toHaveValue(text);
    await expect(findings).toHaveAttribute("data-stale", "false");
    if (restoring) {
      const after = await runStats(page);
      expect(after.cacheHits, "restore the identical prefix's real result outside the input sample").toBe(
        before.cacheHits + 1,
      );
      expect(after.nativeChecks, "prefix restoration does not recompute an already checked diagram").toBe(
        before.nativeChecks,
      );
    }
  }

  let publishedInSample = 0;
  async function sample(held: boolean, ch: string) {
    // Held blocks used to keep stale findings after their first key, while every
    // running key began fresh. That compared different inspector rendering work.
    await expect(findings, "both baselines start with fresh findings").toHaveAttribute("data-stale", "false");
    await holdChecks(page, held);
    const before = await runStats(page);
    const due = nextDue();
    await page.evaluate(() => {
      (window as unknown as { __checkResults: { held: boolean } }).__checkResults.held = true;
    });
    let cpu: number;
    await page.evaluate(() => window.__benchRenders?.start());
    let renders: Renders | undefined;
    try {
      // The run starts inside the sample, including document reads, copying/posting,
      // or the entire engine if it regresses onto the main thread. Replies publish afterwards.
      cpu = await work.key(ch, async () => {
        if (controlled) await scheduled();
        await flush(before);
        await due;
      });
      const end = await page.evaluate((operations) => {
        const edits = operations
          ? { historyPending: window.__historyProbe?.().pending, saved: window.__documentProbe?.().saved }
          : undefined;
        return { edits, renders: window.__benchRenders?.stop() };
      }, !measureCpu);
      renders = end.renders;
      if (!measureCpu)
        expect(end.edits, "edit debounces stay outside the paint-boundary sample").toEqual({
          historyPending: true,
          saved: false,
        });
      publishedInSample += (await runStats(page)).finished - before.finished;
    } finally {
      await page.evaluate(() => {
        (window as unknown as { __checkResults: { release(): void } }).__checkResults.release();
      });
    }
    await finished();
    await painted();
    const after = await runStats(page);
    expect(after.cacheHits, "measured inputs never reuse the restored result").toBe(before.cacheHits);
    expect(
      after.nativeChecks - before.nativeChecks,
      "each measured running input posts to the real checks worker",
    ).toBe(held ? 0 : 1);
    expect(after.workerFailures, "no worker error hands checks back to the main thread").toBe(0);
    expect(after.finished - before.finished).toBe(held ? 0 : 1);
    expect(after.started - before.started).toBe(held ? 0 : 1);
    expect(after.skipped - before.skipped).toBe(held ? 1 : 0);
    return { cpu, renders, started: after.started - before.started };
  }

  const held: number[] = [];
  const running: number[] = [];
  const heldOperations: Renders[] = [];
  const runningOperations: Renders[] = [];
  let runs = 0;
  // Twenty-one adjacent pairs, each typing the same key into the same prefix.
  // The running member leaves fresh findings for the next pair's held member.
  for (let round = 0; round < 3; round++) {
    await prepare(LONG);
    for (const ch of " xyz123") {
      const prefix = await label.inputValue();
      const baseline = await sample(true, ch);
      expect(baseline.started, "checks held: none ran").toBe(0);
      held.push(baseline.cpu);
      if (baseline.renders) heldOperations.push(baseline.renders);
      await prepare(prefix, true);
      const checking = await sample(false, ch);
      running.push(checking.cpu);
      if (checking.renders) runningOperations.push(checking.renders);
      runs += checking.started;
      info.annotations.push({
        type: measureCpu ? "typing-cpu-pair" : "typing-operations-pair",
        description: JSON.stringify({
          round,
          ch,
          ...(measureCpu
            ? { held: baseline.cpu, running: checking.cpu }
            : { held: baseline.renders, running: checking.renders }),
        }),
      });
    }
  }
  await holdChecks(page, false);
  await expect(label).toHaveValue(`${LONG} xyz123`);
  expect(
    await page.evaluate(() => ({
      ...(window as unknown as { __planning: { reads: number; analyses: number; explanations: number } }).__planning,
    })),
  ).toEqual(planningBefore);
  info.annotations.push({
    type: measureCpu ? "typing-cpu" : "typing-operations",
    description: JSON.stringify({
      ...(measureCpu ? { held, running } : { heldOperations, runningOperations }),
      runs,
      publishedInSample,
    }),
  });
  // Checks ran while the second set was typed: one after every key.
  expect(runs).toBe(21);
  // They ran in the checks worker, not on this thread.
  expect(page.workers().length, "the checks worker").toBeGreaterThan(0);
  await work.close();
  if (!measureCpu) {
    expect(heldOperations).toHaveLength(21);
    expect(runningOperations).toHaveLength(21);
    // The same-run median excludes isolated background commits observed in both modes, while
    // one extra render/commit on every checking key changes it. Before isolation this read 100/3.
    // The finding's stale/fix path and both adjacent edges add five renders to the 15-render name path.
    expect(
      median(heldOperations.map((r) => r.total)),
      "renders per key including the stale finding",
    ).toBeLessThanOrEqual(20);
    expect(median(heldOperations.map((r) => r.commits)), "commits per key").toBeLessThanOrEqual(2);
    for (const key of ["total", "commits"] as const) {
      const baseline = median(heldOperations.map((r) => r[key]));
      expect(baseline, "the React hook counted typing work").toBeGreaterThan(0);
      expect(median(runningOperations.map((r) => r[key])), `${key} per key with checks running`).toBe(baseline);
    }
    const names = new Set([...heldOperations, ...runningOperations].flatMap((r) => Object.keys(r.byName)));
    for (const name of names)
      expect(median(runningOperations.map((r) => r.byName[name] ?? 0)), `${name} renders per key`).toBe(
        median(heldOperations.map((r) => r.byName[name] ?? 0)),
      );
  }
  expect(publishedInSample, "worker results publish only after the input sample").toBe(0);
  if (controlled) await page.clock.resume();
  return { held, running };
}
