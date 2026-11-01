import { test } from "./fixtures";
import { runKeyboardTutorial } from "./keyboard-tutorial-driver";
import { keyboardTutorialGroups } from "./keyboard-tutorial-groups";

for (const id of keyboardTutorialGroups[5]) {
  test(`${id}: keyboard solution plays through the real UI`, async ({ page, consoleErrors }) => {
    await runKeyboardTutorial(page, consoleErrors, id);
  });
}
