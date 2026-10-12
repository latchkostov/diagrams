// The agent skill (skills/livediagrams/): its generated files are current, its scripts agree with the app
// (layout, share-link encoding, what the app will open), and validate.mjs explains what's wrong.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { generateSkillFiles, publicExamples, SKILL_DIR } from "../../../scripts/skill-gen";
import { readSkill, zipSkill } from "../../../scripts/skill-assets";
import { decodeShare, encodeShare, sharePayloadFromInput } from "../../interop/share";
import { parseNative } from "../../interop/native";
import { layoutDiagram } from "./layout";

const root = process.cwd();
const skill = path.join(root, SKILL_DIR);
const tmp = mkdtempSync(path.join(tmpdir(), "livediagrams-skill-"));
const examples = publicExamples(root);
let n = 0;

function run(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(skill, "scripts", script), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function write(value: unknown): string {
  const file = path.join(tmp, `d${++n}.diagram.json`);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/** Complete diagrams shown in the skill's docs (as an agent writes them: without coordinates). */
function docExamples(): { name: string; diagram: Record<string, unknown> }[] {
  return ["SKILL.md", "reference/format.md"].flatMap((doc) =>
    [...readFileSync(path.join(skill, doc), "utf8").matchAll(/```json\n([\s\S]*?)```/g)]
      .map((m) => m[1])
      .filter((text) => text.includes('"format": "diagrams/v1"'))
      .map((text) => ({ name: doc, diagram: JSON.parse(text) })),
  );
}

/** Strips what layout.mjs fills in. */
function unplaced(d: object): Record<string, unknown> {
  const c = structuredClone(d) as Record<string, unknown> & {
    nodes: Record<string, unknown>[];
    groups?: Record<string, unknown>[];
  };
  return {
    ...c,
    nodes: c.nodes.map(({ x: _x, y: _y, ...node }) => node),
    ...(c.groups ? { groups: c.groups.map(({ x: _x, y: _y, width: _w, height: _h, ...g }) => g) } : {}),
  };
}

describe("generated skill files", () => {
  it("are current (run `pnpm schemas` after changing the catalog, the format or the layout)", async () => {
    const files = await generateSkillFiles(root);
    expect(Object.keys(files).sort()).toEqual([
      "reference/format.md",
      "reference/simulation.md",
      "reference/stencils.md",
      "scripts/lib/layout.mjs",
      "scripts/lib/spec.json",
    ]);
    for (const [name, text] of Object.entries(files))
      expect(readFileSync(path.join(skill, name), "utf8").replace(/\r\n/g, "\n"), name).toBe(text);
  }, 60_000);

  it("SKILL.md has the frontmatter Agent Skills require, and every relative link resolves", () => {
    const text = readFileSync(path.join(skill, "SKILL.md"), "utf8");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"))?.[1] ?? "";
    const field = (k: string) => new RegExp(`^${k}: (.+)$`, "m").exec(front)?.[1] ?? "";
    expect(field("name")).toBe(path.basename(skill));
    expect(field("name")).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(field("description").length).toBeGreaterThan(50);
    expect(field("description").length).toBeLessThanOrEqual(1024);
    for (const doc of ["SKILL.md", "reference/format.md", "reference/simulation.md", "reference/stencils.md"]) {
      const body = readFileSync(path.join(skill, doc), "utf8");
      for (const [, href] of body.matchAll(/\]\(([^)#:]+)(?:#[^)]*)?\)/g))
        expect(existsSync(path.join(skill, path.dirname(doc), href)), `${doc} -> ${href}`).toBe(true);
    }
  });
});

describe("layout.mjs", () => {
  it.each(examples.map((e) => [e.slug, e.diagram] as const))("lays out %s like the app", (_slug, diagram) => {
    const file = write(unplaced(diagram));
    const r = run("layout.mjs", file);
    expect(r.code, r.err).toBe(0);
    const out = read(file);
    expect(out).toEqual(JSON.parse(JSON.stringify(layoutDiagram(unplaced(diagram)).diagram)));
    expect(parseNative(JSON.stringify(out)).ok).toBe(true);
    expect(run("validate.mjs", file).code).toBe(0);
  });

  it("keeps boundary membership as written and leaves placed diagrams alone", () => {
    const [{ diagram }] = docExamples().filter((e) => e.name === "reference/format.md");
    const file = write(diagram);
    expect(run("layout.mjs", file).code).toBe(0);
    const placed = read(file);
    expect(placed.nodes.find((x: { id: string }) => x.id === "web").group).toBeUndefined();
    const aks = placed.groups[0];
    for (const node of placed.nodes.filter((x: { group?: string }) => x.group === "aks")) {
      expect(node.x).toBeGreaterThanOrEqual(aks.x);
      expect(node.y + 72).toBeLessThanOrEqual(aks.y + aks.height);
    }
    const again = run("layout.mjs", file);
    expect(again.out).toMatch(/nothing to lay out/);
    expect(read(file)).toEqual(placed);
  });
});

describe("validate.mjs", () => {
  it("accepts every public example", () => {
    const r = run("validate.mjs", ...examples.map((e) => path.join(root, "src", "examples", `${e.slug}.json`)));
    expect(r.out).not.toMatch(/error:/);
    expect(r.code, r.out).toBe(0);
  });

  it("accepts the examples in the skill's docs once they're laid out, and the app opens them", () => {
    const docs = docExamples();
    expect(docs.length).toBeGreaterThanOrEqual(2);
    for (const { name, diagram } of docs) {
      const file = write(diagram);
      expect(run("validate.mjs", file).out, name).toMatch(/no x and y.*layout\.mjs/);
      expect(run("layout.mjs", file).code).toBe(0);
      const r = run("validate.mjs", file);
      expect(r.code, `${name}: ${r.out}`).toBe(0);
      expect(r.out, name).not.toMatch(/warning:/);
      const app = parseNative(readFileSync(file, "utf8"));
      expect(app.ok && app.warnings, name).toEqual([]);
    }
  });

  const base = {
    format: "diagrams/v1",
    title: "Fixture",
    groups: [{ id: "vpc", label: "VPC", x: 0, y: 0, width: 800, height: 300 }],
    nodes: [
      { id: "api", stencil: "service.node", label: "API", x: 40, y: 100, group: "vpc" },
      { id: "topic", stencil: "kafka.topic", label: "Kafka", x: 400, y: 100, group: "vpc" },
      { id: "worker", stencil: "service.go", label: "Worker", x: 760, y: 100 },
    ],
    edges: [
      { id: "e1", from: "api", to: "topic", kind: "async" },
      { id: "e2", from: "topic", to: "worker", kind: "async" },
    ],
  };
  type Fixture = typeof base & Record<string, unknown>;
  const broken: [string, (d: Fixture) => unknown, RegExp][] = [
    ["invalid JSON", () => '{ "format": "diagrams/v1", ', /isn't valid JSON/],
    ["the wrong format", (d) => ({ ...d, format: "drawio" }), /"format" must be "diagrams\/v1", not "drawio"/],
    ["no title", (d) => ({ ...d, title: "" }), /Add a "title"/],
    ["no edges list", ({ edges: _, ...d }) => d, /"edges" must be a list/],
    [
      "an unknown stencil",
      (d) => ({ ...d, nodes: [{ ...d.nodes[0], stencil: "kafka-topic" }, ...d.nodes.slice(1)] }),
      /nodes\[0\] "api": unknown stencil "kafka-topic"\. Did you mean kafka\.topic \(Kafka Topic\)/,
    ],
    [
      "a duplicate node id",
      (d) => ({ ...d, nodes: [...d.nodes, { ...d.nodes[2], x: 900 }] }),
      /nodes\[3\] "worker": the id "worker" is already used by node "worker"/,
    ],
    [
      "an edge to a missing node",
      (d) => ({ ...d, edges: [...d.edges, { id: "e3", from: "worker", to: "db", kind: "sync" }] }),
      /edges\[2\] "e3": "to" is "db", which isn't a node id/,
    ],
    [
      "a duplicate edge id",
      (d) => ({ ...d, edges: [...d.edges, { id: "e1", from: "worker", to: "api" }] }),
      /edges\[2\] "e1": another edge already has the id "e1"/,
    ],
    [
      "a node without coordinates",
      (d) => ({ ...d, nodes: [{ id: "api", stencil: "service.node", label: "API" }, ...d.nodes.slice(1)] }),
      /1 of 3 nodes have no x and y\. Run: node scripts\/layout\.mjs/,
    ],
    [
      "an unknown edge kind",
      (d) => ({ ...d, edges: [{ ...d.edges[0], kind: "message" }, d.edges[1]] }),
      /edges\[0\] "e1": "kind" must be "async", "sync"/,
    ],
    [
      "a missing boundary",
      (d) => ({ ...d, nodes: [{ ...d.nodes[0], group: "vnet" }, ...d.nodes.slice(1)] }),
      /"group" is "vnet", but there's no boundary with that id/,
    ],
    [
      "an out-of-range property",
      (d) => ({ ...d, nodes: [{ ...d.nodes[0], props: { failureRate: 2 } }, ...d.nodes.slice(1)] }),
      /nodes\[0\] "api": props\.failureRate must be at most 1/,
    ],
    [
      "a simulation naming a missing node",
      (d) => ({
        ...d,
        simulations: [
          {
            id: "s",
            title: "Storm",
            traffic: [{ id: "t", node: "checkout", shape: { kind: "burst", count: 10 } }],
          },
        ],
      }),
      /simulations\[0\] "Storm": traffic\[0\]\.node refers to "checkout", which isn't a node id/,
    ],
    [
      "a simulation with an unknown traffic shape",
      (d) => ({
        ...d,
        simulations: [{ id: "s", title: "Storm", traffic: [{ id: "t", node: "api", shape: { kind: "wave" } }] }],
      }),
      /unknown kind "wave"; use burst, constant, ramp or spike/,
    ],
  ];

  it("accepts the valid fixture", () => {
    const r = run("validate.mjs", write(base));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^VALID .*: 3 nodes, 2 edges, 1 boundary/);
  });

  it.each(broken)("rejects %s with a useful message", (_name, breakIt, message) => {
    const r = run("validate.mjs", write(breakIt(structuredClone(base) as Fixture) as object));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^INVALID /);
    expect(r.out).toMatch(message);
  });

  it("warns about things that work but read badly", () => {
    const d = structuredClone(base) as Fixture;
    d.nodes[2].label = "Worker that handles every single order event";
    d.edges.pop();
    const r = run("validate.mjs", write(d));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/warning: nodes\[2\] "worker": the label is \d+ characters/);
    expect(r.out).toMatch(/warning: Node "topic" \(topic\) has no consumer/);
  });
});

describe("share-link.mjs", () => {
  const cases = [
    ...examples.map((e) => [e.slug, path.join(root, "src", "examples", `${e.slug}.json`)] as const),
    ...docExamples().map((e, i) => {
      const file = write(e.diagram);
      run("layout.mjs", file);
      return [`${e.name} example ${i + 1}`, file] as const;
    }),
  ];

  it.each(cases)("encodes %s exactly as the app does", async (_name, file) => {
    const r = run("share-link.mjs", file);
    expect(r.code, r.err).toBe(0);
    const url = r.out.trim();
    expect(url.startsWith("https://www.livediagrams.dev/#d=")).toBe(true);
    const payload = sharePayloadFromInput(url)!;
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const original = read(file);
    // The payload is the minified JSON, raw-deflated, base64url without padding...
    expect(JSON.parse(inflateRawSync(Buffer.from(payload, "base64url")).toString("utf8"))).toEqual(original);
    expect(inflateRawSync(Buffer.from(payload, "base64url")).toString("utf8")).toBe(JSON.stringify(original));
    // ...the app's own encoder produces the same link, and its decoder opens it as the same diagram.
    expect(payload).toBe(await encodeShare(original));
    const parsed = parseNative(readFileSync(file, "utf8"));
    expect(parsed.ok).toBe(true);
    expect(await decodeShare(payload)).toEqual(parsed.ok && parsed.diagram);
  });

  it("uses --base for another host, refuses an invalid diagram, and warns when the link is long", () => {
    const ok = write(read(cases[0][1]));
    expect(run("share-link.mjs", ok, "--base", "http://localhost:5521/").out).toMatch(/^http:\/\/localhost:5521\/#d=/);

    const bad = run("share-link.mjs", write({ format: "diagrams/v1", title: "x", nodes: [{ id: "a" }], edges: [] }));
    expect(bad.code).toBe(1);
    expect(bad.out).toBe("");
    expect(bad.err).toMatch(/fix them first/);

    let seed = 7;
    const noise = () => (seed = (seed * 48271) % 2147483647).toString(36);
    const nodes = Array.from({ length: 400 }, (_, i) => ({
      id: `n${i}-${noise()}`,
      stencil: "service.node",
      label: `svc ${noise()}`,
      sublabel: `${noise()} ${noise()}`,
      x: (i % 20) * 360,
      y: Math.floor(i / 20) * 120,
    }));
    const long = run("share-link.mjs", write({ format: "diagrams/v1", title: "Big", nodes, edges: [] }));
    expect(long.code).toBe(0);
    expect(long.out.trim().length).toBeGreaterThan(8000);
    expect(long.err).toMatch(/warning: the link is [\d,]+ characters.*\.diagram\.json file instead/);
  });
});

describe("the downloadable skill", () => {
  it("zips the skill folder deterministically, under livediagrams/", () => {
    const files = readSkill();
    const names = files.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["SKILL.md", "scripts/validate.mjs", "scripts/lib/spec.json"]));
    const zip = zipSkill(files);
    expect(zipSkill(readSkill()).equals(zip)).toBe(true);
    // Read the local file entries back.
    const out = new Map<string, string>();
    for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
      const size = zip.readUInt32LE(at + 18);
      const nameLength = zip.readUInt16LE(at + 26);
      const name = zip.subarray(at + 30, at + 30 + nameLength).toString("utf8");
      const start = at + 30 + nameLength + zip.readUInt16LE(at + 28);
      out.set(name, inflateRawSync(zip.subarray(start, start + size)).toString("utf8"));
      at = start + size;
    }
    expect([...out.keys()]).toEqual(names.map((name) => `livediagrams/${name}`));
    expect(out.get("livediagrams/SKILL.md")).toBe(readFileSync(path.join(skill, "SKILL.md"), "utf8"));
  });
});
