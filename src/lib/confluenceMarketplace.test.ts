import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = "integrations/confluence-forge/marketplace";
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

describe("Confluence Marketplace package", () => {
  it("keeps every pasteable listing field within Atlassian's limits", () => {
    const listing = read(`${directory}/listing.md`);
    const fields = new Map(
      [...listing.matchAll(/^## (.+)\n+([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map((match) => [match[1], match[2].trim()]),
    );
    const limits: [string, number][] = [
      ["App name", 60],
      ["Tagline", 130],
      ["Summary", 250],
      ["More details", 1000],
      ["Release summary", 80],
      ["Release notes", 1000],
      ...[1, 2, 3].flatMap((n): [string, number][] => [
        [`Highlight ${n} title`, 50],
        [`Highlight ${n} text`, 220],
      ]),
    ];
    for (const [field, limit] of limits) {
      const value = fields.get(field);
      expect(value, field).toBeTruthy();
      expect(value!.length, field).toBeLessThanOrEqual(limit);
    }
  });

  it("ships PNG artwork at the documented upload dimensions", () => {
    for (const [name, width, height] of [
      ["logo-144.png", 144, 144],
      ["logo-288.png", 288, 288],
      ["banner-1120.png", 1120, 548],
      ["banner-560.png", 560, 274],
    ] as const) {
      const png = readFileSync(`${directory}/${name}`);
      expect(png.subarray(0, 8).toString("hex"), name).toBe("89504e470d0a1a0a");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], name).toEqual([width, height]);
    }
  });

  it("keeps documentation links local and public policy contacts on GitHub", () => {
    const docs = read("public/confluence.html");
    for (const [, href] of docs.matchAll(/href="(\.[^"]+)"/g)) {
      const [path, fragment] = href.split("#");
      const target = resolve("public", path === "./" ? "../index.html" : path);
      expect(existsSync(target), href).toBe(true);
      if (fragment) expect(read(target), href).toContain(`id="${fragment}"`);
    }
    for (const page of ["confluence", "privacy", "terms"]) {
      const html = read(`public/${page}.html`);
      expect(html, page).not.toMatch(/mailto:/i);
      expect(html, page).toContain("https://github.com/latchkostov/diagrams/issues");
    }
  });
});
