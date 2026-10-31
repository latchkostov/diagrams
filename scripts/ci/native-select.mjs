/* global window, requestAnimationFrame */
// Isolate OS popup input from the application. Record evidence; never replace a keyboard assertion.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import console from "node:console";
import { chromiumLaunchArgs } from "../e2e-chromium.ts";

const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/ci/native-select.mjs <output.json>");
const report = { platform: process.platform, modes: {} };
mkdirSync(dirname(output), { recursive: true });
for (const [mode, keys] of [
  ["arrows", ["ArrowDown", "Enter", "Tab"]],
  ["popup", ["Space", "End", "Enter", "Tab"]],
  ["alt-popup", ["Alt+ArrowDown", "Home", "ArrowDown", "Enter", "Tab"]],
  ["typeahead", ["b", "Tab"]],
]) {
  const browser = await chromium.launch({ args: chromiumLaunchArgs("127.0.0.1") });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<select data-testid="select"><option value="a">Alpha</option><option value="b">Beta</option></select>',
    );
    await page.getByTestId("select").evaluate((select) => {
      window.nativeSelectEvents = [];
      for (const type of ["keydown", "keyup", "input", "change"])
        select.addEventListener(type, (event) => {
          // Observe after application handlers would have run, without cancelling the default action.
          window.queueMicrotask(() => {
            window.nativeSelectEvents.push({
              type: event.type,
              key: event.key,
              trusted: event.isTrusted,
              prevented: event.defaultPrevented,
              value: select.value,
            });
          });
        });
    });
    await page.getByTestId("select").focus();
    const snapshots = [];
    for (const key of keys) {
      await page.keyboard.press(key);
      snapshots.push(
        await page.getByTestId("select").evaluate(
          (select, key) =>
            new Promise((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  resolve({
                    key,
                    value: select.value,
                    selectedIndex: select.selectedIndex,
                    open: select.matches(":open"),
                  }),
                ),
              );
            }),
          key,
        ),
      );
    }
    report.modes[mode] = { snapshots, events: await page.evaluate(() => window.nativeSelectEvents) };
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`Native select ${mode}: value=${snapshots.at(-1).value}`);
  } finally {
    await browser.close();
  }
}
