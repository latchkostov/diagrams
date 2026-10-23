import { ESLint } from "eslint";
import { expect, it } from "vitest";

it("canvas pointer listeners belong to the interaction adapter, with documented legacy exceptions", async () => {
  const eslint = new ESLint();
  const check = async (filePath: string, event: string) => {
    const [result] = await eslint.lintText(`window.addEventListener("${event}", () => {});`, { filePath });
    return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
  };
  for (const event of ["pointermove", "pointerup", "pointercancel"]) {
    expect(await check("src/canvas/edges/EdgeEnds.tsx", event)).toHaveLength(1);
    expect(await check("src/canvas/interaction/usePointerGesture.ts", event)).toEqual([]);
    expect(await check("src/canvas/placement/useDragPlacement.ts", event)).toEqual([]);
  }
  expect(await check("src/canvas/edges/EdgeEnds.tsx", "keydown")).toEqual([]);
});
