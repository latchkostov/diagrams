import { describe, expect, it, vi } from "vitest";
import { ActionRegistry, builtinSections, type Action } from "../editor/actions";
import type { EditorApi, Selection } from "../editor/types";
import type { DiagramFile } from "../model/types";
import { catalog } from "../stencils/catalog";
import type { CanvasHost } from "./host";
import { actionCommands, collectCommands, contextsFor, paletteLabel, type SourceInput } from "./sources";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Test",
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders API", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "Orders DB", sublabel: "primary", x: 300, y: 0 },
  ],
  edges: [{ id: "e1", from: "api", to: "db", kind: "sync" }],
  simulations: [{ id: "peak", title: "Peak traffic" } as NonNullable<DiagramFile["simulations"]>[number]],
} as DiagramFile;

function fakeEditor(selection: Partial<Selection> = {}): EditorApi {
  const sel: Selection = { nodeIds: [], edgeIds: [], groupIds: [], ...selection };
  return {
    getDiagram: () => diagram,
    getSelection: () => sel,
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    getAnnotation: (id: string) => diagram.annotations?.find((a) => a.id === id),
  } as unknown as EditorApi;
}

function registry(): ActionRegistry {
  const r = new ActionRegistry(builtinSections);
  const actions: Action[] = [
    {
      id: "canvas.fit",
      section: "view",
      targets: ["canvas"],
      modes: ["edit", "live"],
      label: "Fit view",
      run: vi.fn(),
    },
    { id: "canvas.auto-layout", section: "arrange", targets: ["canvas"], label: "Auto-layout", run: vi.fn() },
    { id: "canvas.add-node", section: "insert", targets: ["canvas"], label: "Add node here", children: () => [] },
    {
      id: "canvas.undo",
      section: "history",
      targets: ["canvas"],
      label: "Undo",
      enabled: () => false,
      run: vi.fn(),
    },
    {
      id: "node.rename",
      section: "edit",
      targets: ["node"],
      modes: ["edit", "live"],
      label: "Rename",
      paletteLabel: "Rename node",
      run: vi.fn(),
    },
    {
      id: "node.properties",
      section: "edit",
      targets: ["node", "edge"],
      label: "Properties",
      paletteLabel: "Node properties",
      run: vi.fn(),
    },
    {
      id: "selection.group",
      section: "arrange",
      targets: ["node", "selection"],
      label: "Add boundary",
      when: (ctx) => ctx.selection.nodeIds.length > 0,
      children: () => [
        { type: "item", id: "group-tone:blue", label: "Blue", swatch: "#00f", run: vi.fn() },
        { type: "item", id: "group-tone:off", label: "Off", disabled: true, run: vi.fn() },
      ],
    },
    {
      id: "canvas.export",
      section: "file",
      targets: ["canvas"],
      modes: ["edit", "live"],
      label: "Export",
      children: () => [
        { type: "item", id: "export:png", label: "Export PNG", run: vi.fn() },
        { type: "item", id: "export:drawio", label: "draw.io", hint: ".drawio", run: vi.fn() },
      ],
    },
    { id: "sim.reset", section: "simulation", targets: ["canvas"], modes: ["live"], label: "Restart", run: vi.fn() },
    { id: "edge.reverse", section: "edge", targets: ["edge"], label: "Reverse direction", run: vi.fn() },
  ];
  r.register(actions);
  return r;
}

const ids = (cs: { id: string }[]) => cs.map((c) => c.id);

describe("palette action source", () => {
  it("builds the canvas context, plus the selected thing first", () => {
    expect(contextsFor(fakeEditor(), "edit").map((c) => c.target)).toEqual(["canvas"]);
    const node = contextsFor(fakeEditor({ nodeIds: ["api"] }), "edit");
    expect(node.map((c) => c.target)).toEqual(["node", "canvas"]);
    expect(node[0].nodeId).toBe("api");
    expect(contextsFor(fakeEditor({ edgeIds: ["e1"] }), "live")[0]).toMatchObject({
      target: "edge",
      edgeId: "e1",
      mode: "live",
    });
    expect(contextsFor(fakeEditor({ groupIds: ["g"] }), "edit")[0].target).toBe("group");
    expect(contextsFor(fakeEditor({ nodeIds: ["api", "db"] }), "edit")[0].target).toBe("selection");
  });

  it("offers what the context menu would: modes, when, and no disabled entries", () => {
    const r = registry();
    const edit = ids(actionCommands(r, contextsFor(fakeEditor(), "edit")));
    expect(edit).toEqual(
      expect.arrayContaining(["action:canvas.fit", "action:canvas.auto-layout", "action:canvas.export"]),
    );
    expect(edit).not.toContain("action:canvas.undo"); // disabled: hidden, not greyed
    expect(edit).not.toContain("action:sim.reset"); // live only
    expect(edit).not.toContain("action:node.rename"); // nothing selected
    expect(edit).not.toContain("action:canvas.add-node"); // the stencil source covers it

    const live = ids(actionCommands(r, contextsFor(fakeEditor(), "live")));
    expect(live).toContain("action:sim.reset");
    expect(live).not.toContain("action:canvas.auto-layout"); // edit only

    const node = actionCommands(r, contextsFor(fakeEditor({ nodeIds: ["api"] }), "edit"));
    expect(ids(node).slice(0, 2)).toEqual(["action:node.rename", "action:node.properties"]);
    expect(node.find((c) => c.id === "action:node.rename")?.label).toBe("Rename node");
    expect(node.find((c) => c.id === "action:node.properties")?.label).toBe("Node properties");
    expect(ids(node)).not.toContain("action:edge.reverse");
  });

  it("flattens submenus into searchable leaves and drops disabled ones", () => {
    const node = actionCommands(registry(), contextsFor(fakeEditor({ nodeIds: ["api"] }), "edit"));
    const parent = node.find((c) => c.id === "action:selection.group");
    expect(parent?.drill).toBe("Add boundary");
    const blue = node.find((c) => c.id === "action:group-tone:blue");
    expect(blue).toMatchObject({ label: "Add boundary › Blue", swatch: "#00f", idle: false });
    expect(ids(node)).not.toContain("action:group-tone:off");

    const canvas = actionCommands(registry(), contextsFor(fakeEditor(), "edit"));
    expect(canvas.find((c) => c.id === "action:export:png")?.label).toBe("Export PNG");
    expect(canvas.find((c) => c.id === "action:export:drawio")).toMatchObject({
      label: "Export › draw.io",
      hint: ".drawio",
    });
  });

  it("uses action-owned palette labels without inferring nouns for extensions", () => {
    const r = new ActionRegistry();
    r.register([
      {
        id: "custom",
        section: "edit",
        targets: ["node"],
        label: "Aufräumen",
        paletteLabel: (ctx) => `Complete ${ctx.target}`,
      },
      { id: "unconverted", section: "edit", targets: ["node"], label: "Rename" },
    ]);
    const commands = actionCommands(r, contextsFor(fakeEditor({ nodeIds: ["api"] }), "edit"));
    expect(commands.map((c) => c.label)).toEqual(["Complete node", "Rename"]);
    expect(paletteLabel({ type: "item", id: "translated", label: "Aufräumen" })).toBe("Aufräumen");
  });
});

describe("palette sources", () => {
  const host = (selection: Partial<Selection> = {}, live = false): CanvasHost => ({
    editor: fakeEditor(selection),
    live,
    focusNode: vi.fn(),
    addStencil: vi.fn(() => "new"),
  });
  const input = (over: Partial<SourceInput> = {}): SourceInput => ({
    registry: registry(),
    canvas: host(),
    live: { toggle: vi.fn(), goLive: vi.fn() },
    view: "canvas",
    stencils: catalog,
    recentStencils: ["kafka.topic"],
    diagrams: [
      { slug: "mine", title: "Untitled diagram", group: "yours" },
      { slug: "kafka-order-pipeline", title: "Kafka order pipeline", group: "examples" },
      { slug: "current", title: "Open one", group: "examples" },
    ],
    currentSlug: "current",
    openDiagram: vi.fn(),
    sendStencilToCanvas: vi.fn(),
    runSimulation: vi.fn(),
    ...over,
  });

  it("finds each tutorial by title without catalog steps, and keeps the Tutorials view command", () => {
    const startTutorial = vi.fn(),
      openTutorials = vi.fn();
    const commands = collectCommands(
      input({ tutorials: [{ id: "mobile-api", title: "A mobile app talks to an API" }], startTutorial, openTutorials }),
    );
    const lesson = commands.find((c) => c.id === "tutorial:mobile-api")!;
    expect(lesson.label).toBe("Tutorial: A mobile app talks to an API");
    lesson.run?.();
    commands.find((c) => c.id === "view:tutorials")!.run?.();
    expect(startTutorial).toHaveBeenCalledExactlyOnceWith("mobile-api");
    expect(openTutorials).toHaveBeenCalledOnce();
    expect(collectCommands(input()).some((c) => c.id.startsWith("tutorial:"))).toBe(false);
  });

  it("aggregates every source on the canvas", () => {
    const cs = collectCommands(input());
    const all = ids(cs);
    expect(all[0]).toBe("live:toggle");
    expect(all).toEqual(
      expect.arrayContaining([
        "action:canvas.fit",
        "node:api",
        "node:db",
        "sim:peak",
        "stencil:kafka.topic",
        "diagram:mine",
      ]),
    );
    expect(all).not.toContain("diagram:current"); // already open
    // Recent stencils lead the stencil list and show while the query is empty.
    const stencils = cs.filter((c) => c.group === "stencils");
    expect(stencils[0]).toMatchObject({ id: "stencil:kafka.topic", label: "Add Kafka Topic", idle: true });
    expect(stencils[1].idle).toBe(false);
  });

  it("opens the canvas shape picker from one editable-canvas action", () => {
    const openPicker = vi.fn();
    const addAnnotation = vi.fn();
    const canvas = { ...host(), editor: { ...fakeEditor(), addAnnotation }, openPicker };
    const command = collectCommands(input({ canvas })).find((c) => c.id === "action:canvas.add-shape");
    expect(command?.label).toBe("Add shape…");
    command?.run?.();
    expect(openPicker).toHaveBeenCalledOnce();
    const picker = openPicker.mock.calls[0][0] as Parameters<NonNullable<CanvasHost["openPicker"]>>[0];
    expect(picker).toMatchObject({ label: "Select shape", searchable: "Search shapes", testId: "shape-picker" });
    const basic = picker.items().find((item) => item.type === "item" && item.id === "add-shape:cat:basic");
    if (basic?.type !== "item") throw new Error("Missing basic shapes");
    const hexagon = basic.children?.find((item) => item.type === "item" && item.id === "add-shape:hexagon");
    if (hexagon?.type !== "item") throw new Error("Missing hexagon");
    hexagon.run?.();
    expect(addAnnotation).toHaveBeenCalledWith("shape", { shape: "hexagon" });
    for (const over of [{ canvas: { ...canvas, live: true } }, { view: "gallery" as const }, { canvas: null }]) {
      expect(collectCommands(input({ canvas, ...over })).map((c) => c.id)).not.toContain("action:canvas.add-shape");
    }
  });

  it("runs commands through the host", () => {
    const inp = input();
    const cs = collectCommands(inp);
    cs.find((c) => c.id === "node:db")!.run!();
    expect(inp.canvas!.focusNode).toHaveBeenCalledWith("db");
    cs.find((c) => c.id === "stencil:postgres")!.run!();
    expect(inp.canvas!.addStencil).toHaveBeenCalledWith("postgres");
    cs.find((c) => c.id === "sim:peak")!.run!();
    expect(inp.runSimulation).toHaveBeenCalledWith("peak");
    cs.find((c) => c.id === "live:toggle")!.run!();
    expect(inp.live!.toggle).toHaveBeenCalled();
    cs.find((c) => c.id === "diagram:mine")!.run!();
    expect(inp.openDiagram).toHaveBeenCalledWith("mine");
  });

  it("disables simulation switching with the live session's slow-motion hint", () => {
    const inp = input({
      canvas: host({}, true),
      session: { run: vi.fn(), disabledHint: "Exit slow motion (Esc) first" },
    });
    const command = collectCommands(inp).find((c) => c.id === "sim:peak")!;
    expect(command).toMatchObject({ disabled: true, hint: "Exit slow motion (Esc) first" });
    command.run?.();
    expect(inp.runSimulation).not.toHaveBeenCalled();
  });

  it("says where a stencil goes when one node is selected", () => {
    const cs = collectCommands(input({ canvas: host({ nodeIds: ["api"] }) }));
    expect(cs.find((c) => c.id === "stencil:postgres")?.hint).toBe("after Orders API");
  });

  it("hides stencils mid-run and actions without a live view", () => {
    const live = ids(collectCommands(input({ canvas: host({}, true) })));
    expect(live.some((id) => id.startsWith("stencil:"))).toBe(false);
    expect(live).toContain("action:sim.reset");
    const noLive = ids(collectCommands(input({ live: null })));
    expect(noLive).not.toContain("live:toggle");
    expect(noLive.some((id) => id.startsWith("sim:"))).toBe(false);
  });

  it("outside the canvas offers diagrams and sends stencils to the last diagram", () => {
    const inp = input({ view: "gallery", canvas: null, live: null });
    const cs = collectCommands(inp);
    expect(new Set(cs.map((c) => c.group))).toEqual(new Set(["stencils", "diagrams"]));
    expect(ids(cs)).toContain("diagram:current"); // not open in the gallery
    cs.find((c) => c.id === "stencil:aws.sqs")!.run!();
    expect(inp.sendStencilToCanvas).toHaveBeenCalledWith("aws.sqs");
    expect(collectCommands(input({ view: "lab", canvas: null, live: null })).every((c) => c.group === "diagrams")).toBe(
      true,
    );
  });
});

describe("document-scoped commands", () => {
  it("every command whose id carries the diagram's ids says so: Connect to and Reconnect", async () => {
    const { builtinActions } = await import("../editor/builtinActions");
    const r = new ActionRegistry(builtinSections);
    r.register(builtinActions());
    const three = {
      ...diagram,
      nodes: [...diagram.nodes, { id: "cache", stencil: "redis", label: "Orders cache", x: 600, y: 0 }],
    } as DiagramFile;
    const editor = {
      ...fakeEditor({ nodeIds: ["api"] }),
      getDiagram: () => three,
      getNode: (id: string) => three.nodes.find((n) => n.id === id),
      getEdge: (id: string) => three.edges.find((e) => e.id === id),
    } as unknown as EditorApi;
    const commands = actionCommands(r, [
      { target: "node", nodeId: "api", selection: editor.getSelection(), editor, mode: "edit" },
      { target: "edge", edgeId: "e1", selection: editor.getSelection(), editor, mode: "edit" },
    ]);
    const carrying = commands.filter((c) => /:(api|db|cache)$/.test(c.id));
    expect(carrying.map((c) => c.id)).toEqual(expect.arrayContaining(["action:connect:db"]));
    expect(carrying.some((c) => c.id.startsWith("action:reconnect-"))).toBe(true);
    for (const c of carrying) expect(c.documentScoped, c.id).toBe(true);
  });
});
