import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateLiteFiles, LITE_DIR } from "../../../scripts/skill-lite";

describe("script-free directory channel", () => {
  it("is exactly the generated knowledge, with only directory-approved files", () => {
    const root = process.cwd();
    const expected = generateLiteFiles(root);
    const files: string[] = [];
    const walk = (rel: string) => {
      for (const name of readdirSync(path.join(root, LITE_DIR, rel))) {
        const file = path.posix.join(rel, name);
        const stat = lstatSync(path.join(root, LITE_DIR, file));
        expect(stat.isSymbolicLink(), file).toBe(false);
        if (stat.isDirectory()) walk(file);
        else {
          expect(stat.isFile(), file).toBe(true);
          files.push(file);
        }
      }
    };
    walk("");
    expect(files.sort()).toEqual(Object.keys(expected).sort());
    expect(files.length).toBeLessThanOrEqual(512);
    for (const file of files) {
      expect(file).toMatch(/\.(md|txt|json|yaml|yml|png|jpg|jpeg|gif|webp|ico)$/);
      expect(path.basename(file)).not.toMatch(
        /^(package\.json|pnpm-workspace\.yaml|.*lock.*|\.npmrc|\.yarnrc.*|bower\.json|deno\.jsonc?|bunfig\.toml|composer\.json)$/i,
      );
      const data = readFileSync(path.join(root, LITE_DIR, file));
      expect(data.subarray(0, 2).toString(), file).not.toBe("#!");
      if (/\.(md|txt|json|yaml|yml)$/.test(file)) expect(data.length, file).toBeLessThanOrEqual(262_144);
      expect(data.equals(Buffer.from(expected[file])), `${file}: run pnpm regen`).toBe(true);
      if (file.endsWith(".md"))
        for (const [, href] of data.toString("utf8").matchAll(/\]\(([^)#:]+)(?:#[^)]*)?\)/g))
          expect(existsSync(path.join(root, LITE_DIR, path.dirname(file), href)), `${file} -> ${href}`).toBe(true);
    }
    const skill = readFileSync(path.join(root, LITE_DIR, "SKILL.md"), "utf8");
    expect(skill).not.toMatch(/scripts\/|node /);
    expect(skill).toContain("/plugin install livediagrams-full@livediagrams");
    expect(JSON.parse(String(expected[".claude-plugin/plugin.json"]))).toMatchObject({
      name: "livediagrams",
      displayName: "Live Diagrams",
      version: "1.1.0",
    });
  });
});
