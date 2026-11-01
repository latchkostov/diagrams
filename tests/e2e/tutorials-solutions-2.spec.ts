import { test } from "./fixtures";
import { runPointerSolution, runPointerSkipAll, quarantineReason } from "./pointer-tutorial-driver";
import { pointerTutorialGroups } from "./pointer-tutorial-groups";

const entries = pointerTutorialGroups[1];
for (const { id, quarantined } of entries)
  test(`${id}: its solution plays through the real UI`, async ({ page, consoleErrors }) => {
    test.fixme(!!quarantined, quarantineReason);
    await runPointerSolution(page, consoleErrors, id);
  });
for (const { id, quarantined } of entries)
  test(`${id}: Skip-all finishes without saving a diagram`, async ({ page, consoleErrors }) => {
    test.fixme(!!quarantined, quarantineReason);
    await runPointerSkipAll(page, consoleErrors, id);
  });
