import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { releasedFiles } from "../../../scripts/skill-viewer";
import { assembleViewer } from "../../../skills/livediagrams/scripts/lib/viewer.mjs";

describe("directory-readable skill packaging", () => {
  it("ships at most 512 files, each at most 262144 bytes, without long encoded text", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else files.push(file);
      }
    };
    walk("skills/livediagrams");
    expect(files.length).toBeLessThanOrEqual(512);
    for (const file of files) {
      const data = readFileSync(file);
      expect(data.length, file).toBeLessThanOrEqual(262_144);
      if (/\.(?:woff2|png)$/.test(file)) continue;
      expect(data.toString("utf8"), file).not.toMatch(/[A-Za-z0-9+/=]{1025}/);
      if (/viewer-\d+\.js$/.test(file)) expect(() => new Script(data.toString("utf8")), file).not.toThrow();
    }
  });

  it("splits at statement boundaries and restores binary fonts and Unicode exactly", () => {
    const code = `var first=${JSON.stringify("a".repeat(150_000))};var second=${JSON.stringify("b".repeat(150_000))};`;
    const font = Buffer.from("wOF2 test font bytes");
    const original = `<style>/* café */ src:url(data:font/woff2;base64,${font.toString("base64")})</style><script>(function(){${code}})();</script>`;
    const files = releasedFiles(process.cwd(), original);
    expect(Object.keys(files).filter((name) => /viewer-\d+\.js$/.test(name))).toHaveLength(2);
    expect(files["scripts/lib/viewer-font-0.woff2"]).toEqual(font);
    expect(assembleViewer((name) => Buffer.from(files[`scripts/lib/${name}`]))).toBe(original);
  });
});
