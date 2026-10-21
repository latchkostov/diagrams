import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSkill } from "../../../scripts/skill-assets";

const root = process.cwd();
const plugin = path.join(root, "skills/livediagrams");
const read = (file: string) => readFileSync(path.join(plugin, file), "utf8");
const manifest = () =>
  JSON.parse(read(".claude-plugin/plugin.json")) as {
    name: string;
    displayName: string;
    description: string;
    version: string;
    skills: string[];
    icon: string;
  };

describe("the directory plugin bundle", () => {
  it("declares listing metadata and discovers the existing root skill without moving it", () => {
    const metadata = manifest();
    expect(metadata).toMatchObject({
      name: "livediagrams",
      displayName: "Live Diagrams",
      author: { name: "Live Diagrams", url: "https://github.com/latchkostov/diagrams" },
      homepage: "https://www.livediagrams.dev",
      repository: "https://github.com/latchkostov/diagrams",
      license: "MIT",
      keywords: expect.arrayContaining(["diagrams", "architecture", "simulation"]),
      skills: ["./"],
    });
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(metadata.description.length).toBeGreaterThan(40);
    expect(metadata).not.toHaveProperty("author.email");
    for (const entry of metadata.skills) {
      expect(path.resolve(plugin, entry)).toBe(plugin);
      expect(read(path.join(entry, "SKILL.md"))).toMatch(/^---\r?\nname: livediagrams\r?\ndescription: [^\r\n]+/);
    }
    const marketplace = JSON.parse(readFileSync(path.join(root, ".claude-plugin/marketplace.json"), "utf8"));
    expect(marketplace.name).toBe("livediagrams");
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: metadata.name, source: "./skills/livediagrams" }),
    ]);
    expect(marketplace.plugins[0]).not.toHaveProperty("version");
  });

  it("includes a useful README, the complete licence and a directory-sized listing icon", () => {
    const metadata = manifest();
    const readme = read("README.md");
    expect(readme).toContain(`# ${metadata.displayName}`);
    expect(readme).toContain(metadata.description);
    expect(readme.replace(/```[\s\S]*?```/g, "").split(/\s+/).length).toBeGreaterThanOrEqual(40);
    expect(readme).toContain("/plugin install livediagrams@livediagrams");
    expect(read("LICENSE")).toBe(readFileSync(path.join(root, "LICENSE"), "utf8"));
    const iconPath = path.resolve(plugin, metadata.icon);
    expect(path.relative(plugin, iconPath)).not.toMatch(/^\.\./);
    const icon = readFileSync(iconPath);
    expect(icon.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = icon.readUInt32BE(16);
    expect(width).toBeGreaterThanOrEqual(512);
    expect(width).toBeLessThanOrEqual(2048);
    expect(icon.readUInt32BE(20)).toBe(width);
    expect(icon.length).toBeLessThan(2_000_000);
  });

  it("ships regular self-contained files and excludes plugin packaging from the skill download", () => {
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        const stat = lstatSync(file);
        expect(stat.isSymbolicLink(), file).toBe(false);
        if (stat.isDirectory()) walk(file);
        else {
          expect(stat.isFile(), file).toBe(true);
          expect(stat.size, file).toBeLessThan(5 * 1024 * 1024);
        }
      }
    };
    walk(plugin);
    const files = readSkill();
    expect(files.some((f) => f.name === "SKILL.md")).toBe(true);
    expect(files.filter((f) => f.name !== "SKILL.md" && !/^(reference|scripts)\//.test(f.name))).toEqual([]);
    expect(files.map((f) => f.name)).not.toContain("README.md");
    expect(files.map((f) => f.name)).not.toContain("LICENSE");
  });
});
