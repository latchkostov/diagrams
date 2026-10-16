import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildStaticScript } from "../../scripts/static-pages";

describe("standalone page builds", () => {
  it.each(["auth", "skill"])("compiles %s to one classic offline script with only its messages", async (page) => {
    const code = await buildStaticScript(process.cwd(), page);
    expect(() => new Script(code)).not.toThrow(); // No import/export, eval, or module loader needed on file://.
    expect(code).not.toMatch(/\b(?:eval|fetch)\s*\(|\bimport\s*\(/);
    expect(code).toContain(page === "auth" ? "Finishing sign-in" : "Use Live Diagrams with your AI agent");
    expect(code).not.toContain(page === "auth" ? "Use Live Diagrams with your AI agent" : "Finishing sign-in");
    expect(code).not.toContain("react.production");
  });

  it.each([
    ["auth.html", "4c02b08ab1b0d5fdcdb969224f486b2a00b04c73059c217cd2c25f637bc35df7"],
    ["skill/index.html", "59bcb008ec6ff8f0b5db9acc7cacdc37c9f19ddeee3bf9e30552a04a5ddec13b"],
    ["privacy.html", "ecdea3a51ce02a2a00599088e5ce255899bfa88bf12b33c145a1f6bbc54317eb"],
    ["terms.html", "cb89aa1a41a51dff21c05569e5304008c00178b285d956c16e699a3c37842a3b"],
  ])("preserves the baseline HTML bytes: %s", (file, hash) => {
    const html = readFileSync(resolve("public", file), "utf8").replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(html).digest("hex")).toBe(hash);
  });
});
