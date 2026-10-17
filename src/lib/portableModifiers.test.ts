import { ESLint } from "eslint";
import { expect, it } from "vitest";
import { textBoundaryKey } from "../../scripts/e2e-keys";

it("uses native text-caret boundary keys for explicit Mac and non-Mac platforms", () => {
  expect(textBoundaryKey("start", "darwin")).toBe("ControlOrMeta+ArrowLeft");
  expect(textBoundaryKey("end", "darwin")).toBe("ControlOrMeta+ArrowRight");
  for (const platform of ["win32", "linux"] as const) {
    expect(textBoundaryKey("start", platform)).toBe("Home");
    expect(textBoundaryKey("end", platform)).toBe("End");
  }
});

it("E2E primary modifiers use ControlOrMeta with a documented literal-Control escape", async () => {
  const eslint = new ESLint();
  const check = async (text: string) => {
    const [result] = await eslint.lintText(text, { filePath: "tests/e2e/modifier-probe.ts" });
    return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
  };
  expect(await check('const key = "Control+a"; void key;')).toHaveLength(1);
  expect(await check('const key = "ControlOrMeta+a"; void key;')).toEqual([]);
  expect(
    await check(
      '// eslint-disable-next-line no-restricted-syntax -- Literal Ctrl+Alt is cross-platform canvas navigation.\nconst key = "Control+Alt+ArrowRight"; void key;',
    ),
  ).toEqual([]);
});
