import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";
import { catalogLocales, i18n, numberedKeys, readCatalog } from "../../scripts/i18n-plugin";
import en from "../i18n/en";
import { argsOf, parse, tagsOf } from "../i18n/icu";
import { buildStaticScript } from "../../scripts/static-pages";

describe("standalone page builds", () => {
  it.each(["de", "ar", "en-XA"])("keeps standalone-only messages out of the %s app catalog", async (locale) => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [i18n({ pseudo: true })],
      build: {
        write: false,
        copyPublicDir: false,
        rolldownOptions: {
          input: `virtual:i18n/catalog/${locale}`,
          preserveEntrySignatures: "strict",
          output: { format: "iife", name: "probe" },
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
    expect(output).toHaveLength(1);
    const chunk = output[0];
    if (chunk.type !== "chunk") throw new Error("Expected the catalog script");
    const catalog = new Script(chunk.code + "; probe").runInNewContext() as Record<string, unknown>;
    const keys = Object.keys(en).sort() as (keyof typeof en)[];
    const numbered = numberedKeys(catalogLocales().map((code) => readCatalog(code)));
    const messages = locale === "en-XA" ? en : readCatalog(locale);
    const expected = new Set(
      keys
        .filter((key) => !/^(?:staticAuth|staticSkill)\./.test(key) && key in messages)
        .map((key) =>
          argsOf(parse(en[key])).size === 0 && tagsOf(parse(en[key])).size === 0 && !numbered.has(key)
            ? en[key]
            : String(keys.indexOf(key)),
        ),
    );
    expect(Object.keys(catalog).sort()).toEqual([...expected].sort());
  });

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
    // Reviewed Confluence documentation and GitHub policy contacts: 2026-10-20 release fragment.
    ["privacy.html", "80be43ecfb4f9bab6989a695c147ed76036d313e596ccbe5fe9c619a09dc94b8"],
    ["terms.html", "5082ddcf7b0ef81368cacef6e5fd1fe168cbf8cd1b0d04db8679b57c0c11d583"],
    ["confluence.html", "a55920dda125d6c080dfde1e9fb46eb5b15fe26b300b345a013bc4c861acbba8"],
  ])("preserves reviewed markup apart from stable binding attributes: %s", (file, hash) => {
    const html = readFileSync(resolve("public", file), "utf8")
      .replaceAll("\r\n", "\n")
      .replace(/ data-slot="[^"]*"/g, "")
      .replace(
        / data-testid="skill-(?:intro|output-(?:html|diagram|image|link)|label-(?:html|diagram|image|link)|claude-commands|claude-apps|upload|settings|unzip|other-agents|other|then-ask|request|browser-title|browser)"/g,
        "",
      );
    expect(createHash("sha256").update(html).digest("hex")).toBe(hash);
  });
});
