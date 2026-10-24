import { checksTyping } from "../../e2e/checks-typing";
import { median } from "../../e2e/typing-work";
import { CPU_THROTTLE, test, uiSuite } from "./harness";

const suite = uiSuite("checks-typing");

// Keep the original 1,500-node, 21-pair thread-CPU comparison in Benchmarks.
// CI guards the same workload with renders, commits and worker-operation counts.
test("typing a label while checks run versus held", async ({ page }, info) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  try {
    const { held, running } = await checksTyping(page, info, true);
    suite.time(
      "held",
      held.map((seconds) => seconds * 1000),
    );
    suite.time(
      "running",
      running.map((seconds) => seconds * 1000),
    );
    suite.count("running/held", median(running) / median(held), {
      unit: "x",
      limit: 1.5,
      why: "The original same-run checks typing CPU ratio; CI uses operation counts.",
    });
  } finally {
    await cdp.detach();
  }
});
