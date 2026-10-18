import { planningP2Fixture } from "../../lab/planningP2Fixture";
// The agent skill (skills/livediagrams/): its generated files are current, its scripts agree with the app
// (layout, share-link encoding, what the app will open, the HTML export's injection), its released viewer is
// self-consistent, and validate.mjs explains what's wrong.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSkillFiles, publicExamples, SKILL_DIR } from "../../../scripts/skill-gen";
import { readSkill, withFresh, zipSkill } from "../../../scripts/skill-assets";
import generated from "../../../scripts/generated-files.json";
import { selfHostSamples } from "../../../scripts/self-host-headers";
import { hostingTemplates } from "../../../scripts/self-host-templates";
import { applyRelease, iconMap, RELEASED, releasedFiles, type ReleaseFs } from "../../../scripts/skill-viewer";
import {
  buildPayload,
  exportHtml,
  FALLBACK_ICON,
  htmlFileName,
  LOCKED_TITLE,
  PAYLOAD_BLOCK,
  templateStencilIcons,
  type ExportInput,
} from "../../export/inject";
import { unlockPayloadText } from "../../export/lock";
import { decodeShare, encodeShare, sharePayloadFromInput } from "../../interop/share";
import { parseNative } from "../../interop/native";
import { layoutDiagram } from "./layout";

const root = process.cwd();
const skill = path.join(root, SKILL_DIR);
let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "livediagrams-skill-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const examples = publicExamples(root);
let n = 0;

function run(script: string, ...args: string[]) {
  return runWith({}, script, ...args);
}
/** `run` with extra environment variables (and none of the shell's LIVEDIAGRAMS_HTML_PASSWORD). */
function runWith(env: Record<string, string>, script: string, ...args: string[]) {
  const base = { ...process.env };
  delete base.LIVEDIAGRAMS_HTML_PASSWORD;
  const r = spawnSync(process.execPath, [path.join(skill, "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...base, ...env },
  });
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
      .filter((text) => /"format": "diagrams\/v[12]"/.test(text))
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
  it("are current (run `pnpm regen` after changing the catalog, the format or the layout)", async () => {
    const files = await generateSkillFiles(root);
    const all = [
      ...Object.keys(files).map((name) => `${SKILL_DIR}/${name}`),
      ...Object.values(RELEASED).map((name) => `${SKILL_DIR}/${name}`),
      ...Object.keys({ ...selfHostSamples(), ...hostingTemplates() }).map((name) => `deploy/self-host/${name}`),
      "vercel.json",
    ];
    expect([...generated.files, ...generated.regions].sort(), "sync must cover every committed output").toEqual(
      all.sort(),
    );
    const attributes = readFileSync(path.join(root, ".gitattributes"), "utf8");
    for (const name of all) expect(attributes, name).toContain(`${name} linguist-generated=true`);
    expect(Object.keys(files).sort()).toEqual([
      "reference/format.md",
      "reference/simulation.md",
      "reference/stencils.md",
      "scripts/lib/app.mjs",
      "scripts/lib/inject.mjs",
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
    for (const doc of [
      "SKILL.md",
      "reference/format.md",
      "reference/outputs.md",
      "reference/simulation.md",
      "reference/stencils.md",
    ]) {
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
    const direct = layoutDiagram(unplaced(diagram));
    expect(direct.ok).toBe(true);
    expect(out).toEqual(JSON.parse(JSON.stringify(direct.ok && direct.diagram)));
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
  it.each([
    { deadlineMs: -1 },
    { poolConnections: 0 },
    { retry: { maxAttempts: 0, backoffMs: 1, strategy: "fixed", retryOn: ["throttled"] } },
    { retry: { maxAttempts: 2, backoffMs: 1, strategy: "bogus", retryOn: ["throttled"] } },
    { retry: { maxAttempts: 2, backoffMs: 1, strategy: "fixed", retryOn: ["bogus"] } },
  ])("native import rejects malformed caller policies (%j)", (caller) => {
    const d = {
      format: "diagrams/v2",
      planning: { revision: "p3" },
      title: "Caller",
      nodes: [
        { id: "a", stencil: "client.user", label: "Calls", x: 0, y: 0 },
        { id: "b", stencil: "generic.external-api", label: "API", x: 300, y: 0 },
      ],
      edges: [{ id: "call", from: "a", to: "b", kind: "sync", props: { caller } }],
    };
    expect(parseNative(JSON.stringify(d))).toMatchObject({ ok: false, error: expect.stringContaining("caller") });
    const r = run("validate.mjs", write(d));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("caller");
  });
  it("valid caller policies round-trip through native and generated skill validation", () => {
    const d = {
      format: "diagrams/v2",
      planning: { revision: "p3" },
      title: "Caller",
      nodes: [
        { id: "a", stencil: "client.user", label: "Calls", x: 0, y: 0 },
        { id: "b", stencil: "generic.external-api", label: "API", x: 300, y: 0 },
      ],
      edges: [
        {
          id: "call",
          from: "a",
          to: "b",
          kind: "sync",
          props: {
            caller: {
              deadlineMs: 0,
              poolConnections: 2,
              retry: {
                maxAttempts: 2,
                backoffMs: 0,
                strategy: "exponential",
                retryOn: ["throttled", "transient", "timeout"],
                jitter: 0.5,
                idempotent: true,
              },
            },
          },
        },
      ],
    };
    const parsed = parseNative(JSON.stringify(d));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.diagram.edges[0].props?.caller).toEqual(d.edges[0].props.caller);
    const r = run("validate.mjs", write(d));
    expect(r.code, r.out).toBe(0);
  });
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
    ["a private that isn't true", (d) => ({ ...d, private: "yes" }), /"private" must be true/],
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
      /simulations\[0\] "Storm": every traffic entry needs a shape \(burst, constant, ramp or spike\)\. The app would drop/,
    ],
  ];

  it("accepts the valid fixture", () => {
    const r = run("validate.mjs", write(base));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^VALID .*: 3 nodes, 2 edges, 1 boundary/);
  });

  it.each(["#abc", "#abcd", "#fff0", "#abcdef", "#abcdef00", "#11223344", "white", "blue"])(
    "accepts canvas and annotation colours without repairs or unknown-field warnings: %s",
    (color) => {
      const r = run(
        "validate.mjs",
        write({
          ...base,
          color,
          annotations: [{ id: "note", kind: "note", text: "Note", x: 0, y: 400, width: 240, height: 160, color }],
        }),
      );
      expect(r.code, r.out + r.err).toBe(0);
      expect(r.out).not.toMatch(/warning:/);
    },
  );

  it.each(["#12345", "rgb(1,2,3)", { toString: null }])(
    "rejects invalid canvas and annotation colours: %j",
    (color) => {
      const r = run(
        "validate.mjs",
        write({
          ...base,
          color,
          annotations: [{ id: "note", kind: "note", text: "Note", x: 0, y: 400, width: 240, height: 160, color }],
        }),
      );
      expect(r.code, r.err).toBe(1);
      expect(r.out).toMatch(/"color" must be a palette colour or a hex colour/);
      expect(r.out).toMatch(/annotations\[0\] "note": "color"/);
    },
  );

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

  const sim = (
    extra: Record<string, unknown> = {},
    traffic: unknown = [{ id: "t", node: "api", shape: { kind: "constant", ratePerSec: 10, durationMs: 5000 } }],
  ) => ({ id: "s", title: "Run", traffic, ...extra });
  const note = { id: "n1", kind: "note", text: "Retries", x: 0, y: 400, width: 240, height: 160 };
  const discarded: [string, (d: Fixture) => unknown, RegExp][] = [
    ["a non-numeric seed", (d) => ({ ...d, simulations: [sim({ seed: "oops" })] }), /seed or durationMs is invalid/],
    [
      "a negative capacity multiplier",
      (d) => ({ ...d, simulations: [sim({ multipliers: { capacity: -1 } })] }),
      /multipliers must be bounded/,
    ],
    [
      "a capacity multiplier over 100",
      (d) => ({ ...d, simulations: [sim({ multipliers: { capacity: 101 } })] }),
      /multipliers must be bounded/,
    ],
    ["a setup status list", (d) => ({ ...d, simulations: [sim({ setup: { status: [] } })] }), /setup status must map/],
    [
      "a numeric message type",
      (d) => ({
        ...d,
        simulations: [sim({}, [{ id: "t", node: "api", messageType: 7, shape: { kind: "burst", count: 5 } }])],
      }),
      /every traffic entry needs string id, node, label and messageType/,
    ],
    [
      "more traffic profiles than the document allows",
      (d) => ({
        ...d,
        simulations: [
          sim(
            {},
            Array.from({ length: 2001 }, (_, i) => ({ id: `t${i}`, node: "api", shape: { kind: "burst", count: 0 } })),
          ),
        ],
      }),
      /The app would refuse this file: The simulations exceed the document's traffic/,
    ],
    [
      "a note with a negative width",
      (d) => ({ ...d, annotations: [{ ...note, width: -1 }] }),
      /annotations\[0\] "n1": its size must be between 1 and 20000 pixels\. The app would drop it/,
    ],
    [
      "a note outside the coordinate budget",
      (d) => ({ ...d, annotations: [{ ...note, x: 2_000_000 }] }),
      /annotations\[0\] "n1": it's outside the coordinate budget\. The app would drop it/,
    ],
    [
      "an edge to a shape with an invalid size",
      (d) => ({
        ...d,
        annotations: [{ id: "box", kind: "shape", text: "Legacy", x: 0, y: 400, width: 0, height: 80 }],
        edges: [...d.edges, { id: "e3", from: "worker", to: "box", kind: "sync" }],
      }),
      /annotations\[0\] "box": its size must be between 1.*\n.*edges\[2\] "e3": "to" is annotation "box"/,
    ],
    [
      "a shape outline on a note",
      (d) => ({ ...d, annotations: [{ ...note, shape: "ellipse" }] }),
      /only a "shape" annotation takes "shape"/,
    ],
  ];

  it.each(discarded)("rejects %s, which the app would discard", (_name, breakIt, message) => {
    const d = breakIt(structuredClone(base) as Fixture) as object;
    // The app really would lose something: it refuses the file, warns, or opens something else.
    const app = parseNative(JSON.stringify(d));
    expect(app.ok && !app.warnings.length && JSON.stringify(app.diagram) === JSON.stringify(d)).toBe(false);
    const file = write(d);
    const r = run("validate.mjs", file);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(message);
    const link = run("share-link.mjs", file);
    expect(link.code).toBe(1);
    expect(link.out).toBe("");
  });

  const malformed: [string, unknown][] = [
    ["traffic: [null]", sim({}, [null])],
    ["traffic: {}", sim({}, {})],
    ["timeline: {}", sim({ timeline: {} })],
    ["ramp stages: {}", sim({}, [{ id: "t", node: "api", shape: { kind: "ramp", stages: {} } }])],
    ["a null simulation", null],
  ];

  it.each(malformed)("reports %s without throwing, and checks the next file", (_name, simulation) => {
    const bad = write({ ...structuredClone(base), simulations: [simulation] });
    const good = write(base);
    const r = run("validate.mjs", bad, good);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^INVALID .*\n {2}error: simulations\[0\].*The app would drop this simulation/);
    expect(r.out).toMatch(/\nVALID .*: 3 nodes/);
    expect(r.out + r.err).not.toMatch(/TypeError|checker failed|at .*\.mjs:\d+/);
  });

  it("warns when a traffic multiplier makes live view animate too many dots", () => {
    const d = { ...structuredClone(base), simulations: [sim({ scale: 1, multipliers: { traffic: 100 } })] };
    const r = run("validate.mjs", write(d));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /warning: simulations\[0\] "Run": at "scale": 1 with a traffic multiplier of 100.*"scale": 20/,
    );
  });
});

describe("layout.mjs with unusual input", () => {
  it.each([
    ["an unknown direction", { direction: "left-to-right" }],
    ["a null boundary", { groups: [null] }],
    ["a numeric edge label", { edges: [{ id: "e1", from: "a", to: "b", label: 42 }] }],
  ])("lays out a file with %s without crashing, and leaves the problem for validate.mjs", (_name, extra) => {
    const d = {
      format: "diagrams/v1",
      title: "Odd",
      nodes: [
        { id: "a", stencil: "service.node", label: "A" },
        { id: "b", stencil: "postgres", label: "B" },
      ],
      edges: [{ id: "e1", from: "a", to: "b", kind: "sync" }],
      ...extra,
    };
    const file = write(d);
    const r = run("layout.mjs", file);
    expect(r.code, r.err).toBe(0);
    expect(r.err).not.toMatch(/TypeError/);
    const out = read(file);
    for (const [key, value] of Object.entries(extra)) expect(out[key]).toEqual(value);
    expect(out.nodes.every((n: { x?: number }) => typeof n.x === "number")).toBe(true);
    expect(run("validate.mjs", file).code).toBe(1);
  });

  it("explains a file it can't lay out", () => {
    const r = run("layout.mjs", write({ format: "diagrams/v1", title: "x", nodes: [{ id: "a" }], edges: [] }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Can't lay out .*Every node needs an id, a stencil/);
  });

  it("places a new note clear of the annotations already there", () => {
    const d = {
      format: "diagrams/v1",
      title: "Notes",
      nodes: [{ id: "a", stencil: "service.node", label: "A", x: 40, y: 40 }],
      edges: [],
      annotations: [
        { id: "old", kind: "note", text: "Existing", x: 40, y: 172, width: 240, height: 160 },
        { id: "new", kind: "note", text: "Added" },
        { id: "caption", kind: "text", text: "Caption" },
      ],
    };
    const file = write(d);
    expect(run("layout.mjs", file).code).toBe(0);
    const boxes = read(file).annotations as { x: number; y: number; width: number; height: number }[];
    const overlaps = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(boxes[0]).toEqual(d.annotations[0]);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${i} / ${j}`).toBe(false);
    expect(run("validate.mjs", file).code).toBe(0);
  });
});

describe("sharing keeps everything the author wrote", () => {
  it("round-trips simulations and every kind of annotation", async () => {
    const d = {
      format: "diagrams/v1",
      title: "Everything",
      description: "Nodes, a boundary, annotations, dependencies and a simulation.",
      direction: "LR",
      groups: [{ id: "vpc", label: "VPC", tone: "aws", x: 0, y: 0, width: 800, height: 300 }],
      nodes: [
        { id: "api", stencil: "service.node", label: "API", x: 40, y: 100, group: "vpc", props: { ratePerSec: 5 } },
        { id: "q", stencil: "aws.sqs", label: "SQS", sublabel: "orders", x: 400, y: 100, group: "vpc" },
        { id: "worker", stencil: "service.go", label: "Worker", x: 900, y: 100, props: { failureRate: 0.1 } },
        { id: "dlq", stencil: "aws.sqs", label: "Orders DLQ", x: 900, y: 260 },
        { id: "kv", stencil: "vault", label: "Vault", x: 40, y: 400 },
      ],
      edges: [
        { id: "e1", from: "api", to: "q", kind: "async", label: "OrderPlaced" },
        { id: "e2", from: "q", to: "worker", kind: "async" },
        { id: "e3", from: "q", to: "dlq", kind: "async", props: { dlq: true } },
        { id: "e4", from: "api", to: "kv", relation: "secret" },
        { id: "e5", from: "worker", to: "legacy", kind: "sync" },
      ],
      annotations: [
        { id: "title", kind: "text", text: "Orders", x: 0, y: -120, width: 240, height: 80, textSize: "xl" },
        { id: "tip", kind: "note", text: "Retried 3 times", x: 400, y: 400, width: 240, height: 160, color: "yellow" },
        { id: "zone", kind: "zone", text: "Async", x: 360, y: 60, width: 320, height: 160 },
        { id: "legacy", kind: "shape", text: "Mainframe", x: 1300, y: 100, width: 200, height: 80, shape: "cylinder" },
      ],
      simulations: [
        {
          id: "outage",
          title: "Worker outage",
          seed: 3,
          scale: 1,
          multipliers: { traffic: 1, capacity: 1 },
          durationMs: 20000,
          setup: { status: { worker: "up" }, props: { worker: { replicas: 2 } } },
          traffic: [
            {
              id: "t",
              node: "api",
              label: "Orders",
              messageType: "OrderPlaced",
              shape: { kind: "constant", ratePerSec: 10, durationMs: 15000 },
            },
          ],
          timeline: [
            { atMs: 0, action: { do: "note", text: "Steady", focus: ["api"] } },
            { atMs: 5000, action: { do: "status", node: "worker", status: "down" } },
            { atMs: 10000, action: { do: "status", node: "worker", status: "up" } },
          ],
          expectations: [
            {
              id: "x",
              label: "Some dead-lettered",
              metric: { node: "q", field: "deadLettered" },
              op: ">",
              value: 0,
              when: "end",
            },
          ],
        },
      ],
    };
    const file = write(d);
    const v = run("validate.mjs", file);
    expect(v.code, v.out).toBe(0);
    const r = run("share-link.mjs", file);
    expect(r.code, r.err).toBe(0);
    const opened = await decodeShare(sharePayloadFromInput(r.out.trim())!);
    expect(opened).toEqual(d);
    const app = parseNative(JSON.stringify(d));
    expect(app.ok && app.warnings).toEqual([]);
  });
});

describe("share-link.mjs", () => {
  const cases = [
    ...examples.map((e) => [e.slug, () => path.join(root, "src", "examples", `${e.slug}.json`)] as const),
    ...docExamples().map(
      (e, i) =>
        [
          `${e.name} example ${i + 1}`,
          () => {
            const file = write(e.diagram);
            run("layout.mjs", file);
            return file;
          },
        ] as const,
    ),
  ];

  it.each(cases)("encodes %s exactly as the app does", async (_name, fixture) => {
    const file = fixture();
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
    // Nothing the author wrote is lost: the opened diagram is the authored file, with no repairs.
    expect(await decodeShare(payload)).toEqual(original);
    const parsed = parseNative(readFileSync(file, "utf8"));
    expect(parsed.ok && parsed.warnings).toEqual([]);
  });

  it("uses --base for another host, refuses an invalid diagram, and warns when the link is long", () => {
    const ok = write(read(cases[0][1]()));
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
    expect(names).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "scripts/validate.mjs",
        "scripts/export-html.mjs",
        "scripts/lib/spec.json",
        "scripts/lib/viewer-template.html",
      ]),
    );
    const zip = zipSkill(files);
    // The viewer template is most of it (about 415 kB of the zip): keep the download in check.
    expect(zip.length).toBeLessThan(800_000);
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

/** The released viewer (`pnpm skill:release`, scripts/skill-viewer.ts), as committed. */
const committedTemplate = readFileSync(path.join(skill, RELEASED.template), "utf8");
const committedIcons = JSON.parse(readFileSync(path.join(skill, RELEASED.icons), "utf8")) as Record<string, string>;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
const csp = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? "";
/** The contents of every <tag> element without attributes (the executable script, the style). */
const blocks = (html: string, tag: "script" | "style") =>
  [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);

// Not compared with the current app: the committed copy is refreshed only on release (`pnpm skill:check` reports a
// stale one, nightly). It has to work on its own.
describe("the committed viewer", () => {
  it("allows exactly its one inline script and style by hash, and nothing else", () => {
    const [script, ...moreScripts] = blocks(committedTemplate, "script");
    const [style, ...moreStyles] = blocks(committedTemplate, "style");
    expect(moreScripts).toEqual([]);
    expect(moreStyles).toEqual([]);
    const policy = csp(committedTemplate);
    expect(policy).toContain(`script-src 'sha256-${sha256(script)}'`);
    expect(policy).toContain(`style-src 'sha256-${sha256(style)}'`);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toMatch(/unsafe-|worker-src|'self'|https?:/);
  });

  it("has the payload placeholder once, and references nothing outside itself", () => {
    expect(committedTemplate.split(PAYLOAD_BLOCK)).toHaveLength(2);
    expect(committedTemplate).not.toMatch(/<script[^>]+\bsrc=/);
    expect(committedTemplate).not.toMatch(/<link\b(?![^>]*href="data:)/);
    const urls = [...committedTemplate.matchAll(/url\(\s*["']?([^"')\s]{0,40})/g)].map((m) => m[1]);
    expect(urls.filter((u) => !/^(data:|#|$)/.test(u))).toEqual([]);
    expect(committedTemplate).not.toMatch(/particleWorker|assets\/[\w.-]+\.(svg|js|css|woff2)/);
  });

  it("has an icon for every stencil it names, and the fallback", () => {
    const named = new Set(Object.values(templateStencilIcons(committedTemplate)));
    expect(named.size).toBeGreaterThan(100);
    expect(Object.keys(committedIcons)).toContain(FALLBACK_ICON);
    expect([...named].filter((icon) => !Object.hasOwn(committedIcons, icon))).toEqual([]);
    for (const [name, svg] of Object.entries(committedIcons)) expect(svg, name).toMatch(/^<svg[\s>]/);
  });
});

describe("export-html.mjs", () => {
  it("validates and exports p2 revision, vocabulary and producer metadata without loss", () => {
    const diagram = planningP2Fixture();
    diagram.nodes[1].props = { messageKB: 128, ingestUnits: 2 };
    const file = write(diagram);
    const valid = run("validate.mjs", file);
    expect(valid.code, valid.out).toBe(0);
    const target = path.join(tmp, "html", "p2.html");
    const result = run("export-html.mjs", file, "--out", target);
    expect(result.code, result.err).toBe(0);
    const html = readFileSync(target, "utf8");
    expect(
      JSON.parse(/<script type="application\/json" id="diagram">([\s\S]*?)<\/script>/.exec(html)![1]).diagram,
    ).toEqual(diagram);
    const spec = read(path.join(skill, "scripts/lib/spec.json"));
    expect(spec.stencils.find((s: { id: string }) => s.id === "aws.sns").broker).toMatchObject({
      partitioned: false,
      assignment: "subscriptions",
    });
    expect(spec.stencils.find((s: { id: string }) => s.id === "aws.kinesis").broker).toMatchObject({
      partitioned: true,
      assignment: "shards",
    });
  });

  const kafka = path.join(root, "src", "examples", "kafka-order-pipeline.json");
  const out = (...parts: string[]) => path.join(tmp, "html", ...parts);

  it.each(["#fff0", "#11223344"])("exports custom colours and their alpha without loss: %s", (color) => {
    const diagram = {
      ...read(kafka),
      color,
      annotations: [{ id: "custom-note", kind: "note", text: "Note", x: 0, y: 1000, width: 240, height: 160, color }],
    };
    const target = out(`custom-${color.slice(1)}.html`);
    const result = run("export-html.mjs", write(diagram), "--out", target);
    expect(result.code, result.err).toBe(0);
    const html = readFileSync(target, "utf8");
    const exported = JSON.parse(/<script type="application\/json" id="diagram">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(exported.diagram).toEqual(diagram);
  });

  it("makes the file src/export/inject.ts makes from the committed viewer, for every option", () => {
    // inject.mjs (byte-identical to a fresh build of inject.ts, above) behaves as inject.ts does.
    const diagram = read(kafka);
    const expected = (input: Partial<ExportInput>) =>
      exportHtml(committedTemplate, {
        diagram,
        iconSvgs: committedIcons,
        theme: "light",
        exportedOn: "2026-10-12",
        ...input,
      });
    const cases: [string[], Partial<ExportInput>][] = [
      [[], { startSimulation: "black-friday" }],
      [
        ["--theme", "dark", "--banner", "Confidential: internal use only", "--sim", "payments-outage"],
        { theme: "dark", banner: "Confidential: internal use only", startSimulation: "payments-outage" },
      ],
      [["--title", "Orders (team copy)", "--no-autoplay"], { title: "Orders (team copy)", startSimulation: null }],
    ];
    for (const [i, [args, input]] of cases.entries()) {
      const dir = out(`case${i}`);
      const r = run("export-html.mjs", kafka, "--out", dir, "--exported-on", "2026-10-12", ...args);
      expect(r.code, r.err).toBe(0);
      const file = path.join(dir, htmlFileName(input.title ?? diagram.title));
      const html = readFileSync(file, "utf8");
      // It reports the path, the file's real size and what plays.
      const kB = Math.max(1, Math.round(Buffer.byteLength(html) / 1000)).toLocaleString("en-US");
      const sim = diagram.simulations.find((x: { id: string }) => x.id === input.startSimulation);
      const [first, note] = r.out.trim().split("\n");
      expect(first).toBe(`${file} (${kB} kB${sim ? `, plays "${sim.title}" when opened` : ""})`);
      expect(note).toMatch(/^Private: .*no network requests.*only people who have the file can open it/);
      expect(html === expected(input), args.join(" ") || "defaults").toBe(true);
      // The payload is a data block: the policy still matches the untouched script and style.
      expect(csp(html)).toBe(csp(committedTemplate));
      expect(blocks(html, "script")).toEqual(blocks(committedTemplate, "script"));
    }
  });

  it("exports a private diagram, which share-link.mjs refuses", () => {
    const file = write({ ...read(kafka), title: "Ledger flow", private: true });
    const valid = run("validate.mjs", file);
    expect(valid.code, valid.out).toBe(0);
    expect(valid.out).not.toMatch(/warning:/);
    const link = run("share-link.mjs", file);
    expect(link.code).toBe(1);
    expect(link.out).toBe("");
    expect(link.err).toMatch(/private diagram.*export-html.mjs/);
    const r = run("export-html.mjs", file, "--out", out("private.html"));
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(out("private.html"), "utf8")).toContain('"private":true');
  });

  it("refuses a file the viewer wouldn't show as made, before writing anything", () => {
    // Valid, but escaping its 2,000,100 "<" (6 characters each in the payload) takes it past the viewer's budget.
    const big = write({
      format: "diagrams/v1",
      title: "Big",
      description: "<".repeat(2_000_100),
      nodes: [{ id: "a", stencil: "postgres", label: "A", x: 0, y: 0 }],
      edges: [],
    });
    expect(run("validate.mjs", big).code).toBe(0);
    const tooBig = run("export-html.mjs", big, "--out", out("big"));
    expect(tooBig.code).toBe(1);
    expect(tooBig.err).toMatch(/the viewer wouldn't show the file as made\. It's too large to open/);
    expect(existsSync(out("big"))).toBe(false);
    // The viewer shows at most 300 characters of banner.
    const banner = run("export-html.mjs", kafka, "--out", out("banner"), "--banner", "x".repeat(301));
    expect(banner.code).toBe(1);
    expect(banner.err).toMatch(/The banner is too long: the viewer shows at most 300 characters/);
    expect(existsSync(out("banner"))).toBe(false);
  });

  it("refuses an invalid diagram and bad options, and writes nothing", () => {
    const broken = run(
      "export-html.mjs",
      write({ format: "diagrams/v1", title: "x", nodes: [{ id: "a" }], edges: [] }),
    );
    expect(broken.code).toBe(1);
    expect(broken.err).toMatch(/fix them first/);
    const unplaced = write({
      format: "diagrams/v1",
      title: "x",
      nodes: [{ id: "a", stencil: "postgres", label: "A" }],
      edges: [],
    });
    expect(run("export-html.mjs", unplaced).err).toMatch(/layout\.mjs/);
    expect(run("export-html.mjs", kafka, "--theme", "blue").code).toBe(2);
    expect(run("export-html.mjs", kafka, "--sim", "nope").err).toMatch(/isn't one of this diagram's simulations/);
    expect(run("export-html.mjs", kafka, "--colour", "red").code).toBe(2);
    expect(run("export-html.mjs").code).toBe(2);
    expect(existsSync(path.join(root, "src", "examples", "Kafka order pipeline.html"))).toBe(false);
    expect(readdirSync(tmp).filter((f) => f.endsWith(".html"))).toEqual([]);
  });

  it("--password: the app's encryption, the password from the environment, nothing readable in the file", async () => {
    const diagram = read(kafka);
    const password = "quartz meadow tangle 81";
    const dir = out("locked");
    const r = runWith(
      { LIVEDIAGRAMS_HTML_PASSWORD: password },
      "export-html.mjs",
      kafka,
      "--password",
      "--out",
      dir,
      "--banner",
      "Confidential: internal use only",
      "--exported-on",
      "2026-10-12",
    );
    expect(r.code, r.err).toBe(0);
    expect(r.err).toBe("");
    // Its name and title say nothing of the diagram: the neutral title and a random suffix.
    const first = r.out.trim().split("\n")[0];
    expect(first).toMatch(/Diagram \(password protected\) [a-z2-9]{5}\.html \([\d,]+ kB, password protected, plays "/);
    const file = first.replace(/ \([\d,]+ kB.*$/, "");
    expect(path.dirname(file)).toBe(dir);
    expect(r.out).toMatch(/only people with the password can open it.*Send the password separately/);
    const html = readFileSync(file, "utf8");
    expect(html).toContain(`<title>${LOCKED_TITLE}</title>`);
    for (const text of [diagram.title, "Confidential", ...diagram.nodes.map((n: { label: string }) => n.label)])
      expect(html.includes(text), text).toBe(false);
    // The policy and script are the template's; the block is the token and the theme.
    expect(csp(html)).toBe(csp(committedTemplate));
    expect(blocks(html, "script").slice(-1)).toEqual(blocks(committedTemplate, "script").slice(-1));
    const block = /<script type="application\/json" id="diagram">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const locked = JSON.parse(block) as { version: number; encrypted: string; theme: string };
    expect(Object.keys(locked).sort()).toEqual(["encrypted", "theme", "version"]);
    // The app's own decryption opens it into the payload the app would have made.
    const text = await unlockPayloadText(locked.encrypted, password, 50_000_000);
    expect(JSON.parse(text)).toEqual(
      buildPayload(committedTemplate, {
        diagram,
        iconSvgs: committedIcons,
        theme: "light",
        banner: "Confidential: internal use only",
        startSimulation: "black-friday",
        exportedOn: "2026-10-12",
      }),
    );
    await expect(unlockPayloadText(locked.encrypted, "quartz meadow tangle 18", 50_000_000)).rejects.toThrow(
      /doesn't open this file/,
    );
  }, 60_000);

  it("never replaces a file: protected exports get names of their own, a taken name the next free one", () => {
    const dir = out("collide");
    const env = { LIVEDIAGRAMS_HTML_PASSWORD: "quartz meadow tangle 81" };
    const other = write({ ...read(kafka), title: "Another diagram" });
    // Two different diagrams, protected, into one folder: two files, each still the one exported.
    const a = runWith(env, "export-html.mjs", kafka, "--password", "--out", dir);
    const b = runWith(env, "export-html.mjs", other, "--password", "--out", dir);
    expect([a.code, b.code], a.err + b.err).toEqual([0, 0]);
    const [fileA, fileB] = [a, b].map((r) => r.out.split("\n")[0].replace(/ \([\d,]+ kB.*$/, ""));
    expect(fileA).not.toBe(fileB);
    expect(readdirSync(dir).sort()).toEqual([path.basename(fileA), path.basename(fileB)].sort());
    expect(readFileSync(fileA, "utf8")).not.toBe(readFileSync(fileB, "utf8"));
    // A default name that's taken: the next free one, and the script says so.
    const plain1 = run("export-html.mjs", kafka, "--out", dir);
    const plain2 = run("export-html.mjs", kafka, "--out", dir);
    expect([plain1.code, plain2.code]).toEqual([0, 0]);
    expect(plain2.out).toContain(path.join(dir, "Kafka order pipeline (2).html"));
    expect(plain2.err).toMatch(
      /Kafka order pipeline\.html already exists there, so this one is Kafka order pipeline \(2\)\.html/,
    );
    // A named --out that exists: refused, untouched, unless --force.
    const named = path.join(dir, "Kafka order pipeline.html");
    const before = readFileSync(named, "utf8");
    const refused = runWith(env, "export-html.mjs", kafka, "--password", "--out", named);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/already exists\. Nothing was written.*--force/);
    expect(readFileSync(named, "utf8")).toBe(before);
    const forced = runWith(env, "export-html.mjs", kafka, "--password", "--out", named, "--force");
    expect(forced.code, forced.err).toBe(0);
    expect(readFileSync(named, "utf8")).toContain(`<title>${LOCKED_TITLE}</title>`);
  }, 60_000);

  it("--password never takes the password from the command line, and needs one to write anything", () => {
    const dir = out("refused");
    const inArgs = run("export-html.mjs", kafka, "--password=hunter2hunter2", "--out", dir);
    expect(inArgs.code).toBe(2);
    expect(inArgs.err).toMatch(/takes no value.*shell history.*LIVEDIAGRAMS_HTML_PASSWORD/);
    const asNext = run("export-html.mjs", kafka, "--password", "hunter2hunter2", "--out", dir);
    expect(asNext.code).toBe(2);
    expect(asNext.err).toMatch(/takes no value/);
    // No variable and no terminal to ask in (stdin is a pipe here).
    const none = run("export-html.mjs", kafka, "--password", "--out", dir);
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/needs the password in LIVEDIAGRAMS_HTML_PASSWORD, or a terminal/);
    const short = runWith(
      { LIVEDIAGRAMS_HTML_PASSWORD: "short" },
      "export-html.mjs",
      kafka,
      "--password",
      "--out",
      dir,
    );
    expect(short.code).toBe(1);
    expect(short.err).toMatch(/at least 8 characters/);
    expect(existsSync(dir)).toBe(false);
    // A guessable one works, with the strength hint's warning.
    const weak = runWith(
      { LIVEDIAGRAMS_HTML_PASSWORD: "password1" },
      "export-html.mjs",
      kafka,
      "--password",
      "--out",
      dir,
    );
    expect(weak.code, weak.err).toBe(0);
    expect(weak.err).toMatch(/^warning: Easy to guess/);
  }, 60_000);

  it("uses nothing that could reach the network", () => {
    for (const f of ["export-html.mjs", "lib/inject.mjs", "lib/check.mjs"]) {
      const code = readFileSync(path.join(skill, "scripts", f), "utf8");
      expect(code, f).not.toMatch(/node:(http|https|net|dgram|tls|dns)\b|\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });
});

describe("releasing the viewer", () => {
  it("uses commit tracking without a competing manifest version", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(manifest.plugins[0]).not.toHaveProperty("version");
    expect(existsSync(path.join(skill, ".claude-plugin", "plugin.json"))).toBe(false);
  });

  it("a release that fails partway changes nothing, so a retry refreshes both assets", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "livediagrams-release-"));
    try {
      const asset = path.join(dir, "viewer-template.html");
      const icons = path.join(dir, "icons.json");
      writeFileSync(asset, "old template");
      writeFileSync(icons, "old icons");
      const files = { [asset]: "new template…", [icons]: "new icons" };
      const state = () => [asset, icons].map((f) => readFileSync(f, "utf8"));
      const listing = () => readdirSync(dir).sort();
      const before = state();

      // The second asset's swap fails: the assets already swapped get their old contents back.
      let failIcons = true;
      const fs: ReleaseFs = {
        readFileSync: (f, e) => readFileSync(f, e),
        writeFileSync: (f, t, encoding) => {
          expect(encoding).toBe("utf8");
          writeFileSync(f, t, encoding);
        },
        renameSync: (from, to) => {
          if (failIcons && to === icons) throw new Error("disk full");
          renameSync(from, to);
        },
        rmSync: (f, o) => rmSync(f, o),
        existsSync: (f) => existsSync(f),
      };
      expect(() => applyRelease(files, fs)).toThrow(/disk full/);
      expect(state()).toEqual(before);
      expect(listing()).toEqual(["icons.json", "viewer-template.html"]);
      // Staging fails: nothing is swapped at all.
      failIcons = false;
      const readOnly: ReleaseFs = {
        ...fs,
        writeFileSync: () => {
          throw new Error("read-only");
        },
      };
      expect(() => applyRelease(files, readOnly)).toThrow(/read-only/);
      expect(state()).toEqual(before);

      // The retry sees the same stale files, and completes.
      applyRelease(files, fs);
      expect(state()).toEqual(["new template…", "new icons"]);
      expect(readFileSync(asset).subarray(0, 3).toString("hex")).not.toBe("efbbbf");
      expect(listing()).toEqual(["icons.json", "viewer-template.html"]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("the site serves a fresh template and icons in place of the committed ones", () => {
    const files = readSkill();
    const fresh = releasedFiles(root, "<!doctype html><title>fresh</title>\n");
    const served = withFresh(files, fresh);
    expect(served.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(served.find((f) => f.name === RELEASED.template)?.data.toString("utf8")).toBe(fresh[RELEASED.template]);
    expect(JSON.parse(served.find((f) => f.name === RELEASED.icons)!.data.toString("utf8"))).toEqual(iconMap(root));
    expect(served.find((f) => f.name === "SKILL.md")).toBe(files.find((f) => f.name === "SKILL.md"));
    expect(() => withFresh(files, { "scripts/lib/nope.html": "" })).toThrow(/no scripts\/lib\/nope\.html/);
  });
});
