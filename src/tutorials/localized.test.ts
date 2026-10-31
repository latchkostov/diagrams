import { readFileSync } from "node:fs";
import { catalogLocales } from "../../scripts/i18n-plugin";
import { afterAll, afterEach, expect, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../i18n";
import { stencils } from "../stencils/registry";
import { searchStencils } from "../lib/stencilDisplaySearch";
import { collectCommands } from "../palette/sources";
import { flatten, rank } from "../palette/rank";
import { editorHarness } from "../test/editorHarness";
import { actionRegistry } from "../editor/actions";
import { resolveSubjects, fillTestId } from "./checks";
import { commandPalette } from "./catalog/commandPalette";
import type { DiagramFile } from "../model/types";
import type { Tutorial, TutorialStep, Words } from "./types";
import { allTutorials } from "./catalog";
import type { Check } from "./types";
import { builtinActions } from "../editor/builtinActions";
import { fileActions } from "../interop/fileActions";
import type { InteropApi } from "../interop/useInterop";

const stopCommands = actionRegistry.register([
  ...builtinActions(),
  ...fileActions(() => ({ importReport: {}, privacy: () => null }) as InteropApi),
]);
afterAll(stopCommands);

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

const locales = ["en", ...Object.keys(catalogs)];
async function language(code: string) {
  state.l = code;
  state.c = code === "en" ? undefined : ((await catalogs[code]()).default as Catalog);
}

const leaves = (check: Check): Check[] => (check.kind === "all" ? check.checks.flatMap(leaves) : [check]);

it.each(locales)("%s: tutorial instructions contain the exact values their checks require", async (code) => {
  await language(code);
  for (const tutorial of allTutorials) {
    for (const step of tutorial.steps) {
      for (const check of leaves(step.check)) {
        const values: string[] = [];
        if (check.kind === "label" || (check.kind === "field" && check.is)) values.push(check.is!());
        if (check.kind === "prop" && check.prop === "group" && "value" in check && typeof check.value === "string")
          values.push(check.value);
        if (check.kind === "prop" && check.prop === "filter" && "value" in check && Array.isArray(check.value))
          values.push(...check.value.filter((value): value is string => typeof value === "string"));
        if (check.kind === "prop" && Array.isArray(check.prop)) {
          for (const segment of check.prop)
            if (typeof segment === "object" && "where" in segment && typeof segment.where.key === "string")
              values.push(segment.where.key);
        }
        for (const value of values)
          expect.soft(step.goal(), `${code}/${tutorial.id}/${step.id}: ${value}`).toContain(value);
      }
    }
  }
});

function lessonEditor(tutorial: Tutorial) {
  const diagram: DiagramFile =
    typeof tutorial.start === "function"
      ? tutorial.start()
      : JSON.parse(readFileSync(`src/examples/${tutorial.start.example}.json`, "utf8"));
  const harness = editorHarness(structuredClone(diagram));
  return { ...harness.api, commit: harness.commit };
}

function instructions(step: TutorialStep): Words[] {
  return [
    step.title,
    step.goal,
    ...(step.hint ? [step.hint] : []),
    ...(step.done ? [step.done] : []),
    ...step.targets.map((target) => target.tip),
    ...(typeof step.settle === "object" ? [step.settle.tip] : []),
  ];
}

it.each(["en", ...catalogLocales()])(
  "localized instructions name the visible simulation and node (%s)",
  async (code) => {
    const references: { tutorial: Tutorial; words: Words; english: string; kind: "node" | "simulation"; id: string }[] =
      [];
    await language("en");
    for (const tutorial of allTutorials) {
      const diagram = lessonEditor(tutorial).getDiagram();
      const names = [
        ...diagram.nodes.map((node) => ({ kind: "node" as const, id: node.id, value: node.label })),
        ...(diagram.simulations ?? []).map((simulation) => ({
          kind: "simulation" as const,
          id: simulation.id,
          value: simulation.title,
        })),
      ];
      for (const step of tutorial.steps)
        for (const words of instructions(step)) {
          const english = words();
          // Names are sometimes quoted and sometimes bare (for example, "Hover Decision service").
          for (const name of names)
            if (name.value && english.includes(name.value))
              references.push({ tutorial, words, english, kind: name.kind, id: name.id });
        }
    }

    await language(code);
    const diagrams = new Map(allTutorials.map((tutorial) => [tutorial.id, lessonEditor(tutorial).getDiagram()]));
    for (const { tutorial, words, english, kind, id } of references) {
      const diagram = diagrams.get(tutorial.id)!;
      const displayed =
        kind === "node"
          ? diagram.nodes.find((node) => node.id === id)!.label
          : diagram.simulations!.find((simulation) => simulation.id === id)!.title;
      expect.soft(words(), `${code}/${tutorial.id}/${kind}/${id}: ${english}`).toContain(displayed);
    }
  },
);

function commands(editor: ReturnType<typeof lessonEditor>) {
  return collectCommands({
    registry: actionRegistry,
    canvas: { editor, live: false, focusNode: () => {}, addStencil: (id) => editor.addStencil(id) },
    live: null,
    view: "canvas",
    stencils,
    recentStencils: [],
    diagrams: [],
    openDiagram: () => {},
    sendStencilToCanvas: () => {},
    runSimulation: () => {},
  });
}

// Replay creation through the real editor: its stored defaults are deliberately not localized stencil display names.
function replay(editor: ReturnType<typeof lessonEditor>, tutorial: Tutorial, step: Tutorial["steps"][number]) {
  for (const demo of step.demo) {
    const subjects = resolveSubjects(tutorial, editor.getDiagram());
    if (demo.kind === "add") {
      if (demo.after) editor.createConnected({ from: subjects[demo.after]!, stencil: demo.stencil });
      else {
        editor.select({ nodeIds: [], edgeIds: [], groupIds: [] });
        editor.addStencil(demo.stencil);
      }
    }
    if (demo.kind === "insert") {
      const edge = editor
        .getDiagram()
        .edges.find((e) => e.from === subjects[demo.edge[0]] && e.to === subjects[demo.edge[1]]);
      if (!edge) throw new Error("Missing insertion edge");
      editor.insertNode(edge.id, demo.stencil);
    }
    if (demo.kind === "connect") editor.connect(subjects[demo.from]!, subjects[demo.to]!);
    if (demo.kind === "rename") editor.updateNode(subjects[demo.subject]!, { label: demo.label() });
    if (demo.kind === "field") editor.updateNode(subjects[demo.subject]!, { [demo.field]: demo.value() });
    if (demo.kind === "select") editor.select({ nodeIds: demo.subjects.map((s) => subjects[s]!) });
    editor.commit();
  }
  if (step.check.kind === "navigation") {
    editor.select({ nodeIds: [resolveSubjects(tutorial, editor.getDiagram())[step.check.subject]!] });
    editor.commit();
  }
}

it("German consumer-group instructions name the consumers created by the lesson", async () => {
  await language("de");
  const tutorial = allTutorials.find((tutorial) => tutorial.id === "kafka-topic")!;
  const editor = lessonEditor(tutorial);
  for (const step of tutorial.steps) {
    if (step.id === "group-billing" || step.id === "group-email") {
      const subject = step.id.slice("group-".length);
      const id = resolveSubjects(tutorial, editor.getDiagram())[subject];
      const name = editor.getDiagram().nodes.find((node) => node.id === id)!.label;
      expect(step.title()).toContain(name);
      expect(step.goal()).toContain(name);
      expect(step.goal()).toContain(subject);
      expect(step.targets[0].tip()).toContain(name);
    }
    replay(editor, tutorial, step);
  }
});

it.each(locales)("localized tutorial searches find their intended target (%s)", async (code) => {
  await language(code);
  for (const tutorial of allTutorials) {
    const editor = lessonEditor(tutorial);
    for (const step of tutorial.steps) {
      const intended = step.demo.filter((demo) => demo.kind === "add" || demo.kind === "insert");
      let stencilIndex = 0;
      const queries: { text: string; enter: boolean; command: boolean; target?: string | null }[] = [];
      if (step.guide?.quickAdd) queries.push({ text: step.guide.quickAdd(), enter: true, command: false });
      for (const [i, action] of step.solution.entries()) {
        if (
          ("fill" in action && ["quick-add-search", "palette-search", "command-input"].includes(action.fill)) ||
          ("type" in action && typeof action.type === "function")
        ) {
          const text = "fill" in action ? action.text : action.type;
          const next = step.solution[i + 1];
          queries.push({
            text: typeof text === "function" ? text() : text,
            enter: !!next && "press" in next && next.press === "Enter",
            command: "fill" in action && action.fill === "command-input",
            target:
              next && "click" in next && next.click.startsWith("command-item-")
                ? fillTestId(next.click.slice("command-item-".length), resolveSubjects(tutorial, editor.getDiagram()))
                : undefined,
          });
        }
      }
      for (const query of queries) {
        const context = `${code}/${tutorial.id}/${step.id}: ${JSON.stringify(query.text)}`;
        if (query.command) {
          const target =
            query.target ??
            (tutorial.id === "import-and-review"
              ? "action:file.import-report"
              : `stencil:${intended[stencilIndex++].stencil}`);
          const found = flatten(rank(commands(editor), query.text)).map((c) => c.id);
          expect.soft(found, context).toContain(target);
          expect.soft(step.goal(), context).toContain(commands(editor).find((c) => c.id === target)!.label);
          if (query.enter) expect.soft(found[0], context).toBe(target);
          expect.soft(step.goal(), context).toContain(query.text);
          for (const tip of step.targets) expect.soft(tip.tip(), context).toContain(query.text);
        } else {
          if (
            ["quick-add/add-app", "api-gateway/add-app", "insert-on-edge/insert"].includes(`${tutorial.id}/${step.id}`)
          )
            expect.soft(step.goal(), `${context}: instructed search`).toContain(query.text);
          const toolCheck = leaves(step.check).find((check) => check.kind === "toolSearch");
          const target = intended[stencilIndex++]?.stencil ?? toolCheck?.stencil;
          expect(target, `${context}: every stencil search has a target`).toBeTruthy();
          const found = searchStencils(stencils, query.text).map((s) => s.id);
          expect.soft(found, context).toContain(target);
          if (query.enter) expect.soft(found[0], context).toBe(target);
        }
      }
      replay(editor, tutorial, step);
    }
  }
});

it.each(["ar", "ja"])("localized command-palette goto finds the created topic (%s)", async (code) => {
  await language(code);
  const editor = lessonEditor(commandPalette);
  const add = commandPalette.steps[0];
  const goto = commandPalette.steps[1];
  const search = add.solution.find((a) => "fill" in a && a.fill === "command-input")!;
  if (!("fill" in search)) throw new Error("Missing search");
  const query = typeof search.text === "function" ? search.text() : search.text;
  const create = flatten(rank(commands(editor), query)).find((c) => c.id === "stencil:kafka.topic")!;
  create.run!();
  editor.commit();
  const topic = editor.getDiagram().nodes.find((n) => n.stencil === "kafka.topic")!;
  const action = goto.solution.find((a) => "fill" in a && a.fill === "command-input")!;
  if (!("fill" in action)) throw new Error("Missing node search");
  const text = typeof action.text === "function" ? action.text() : action.text;
  expect.soft(text).toBe(topic.label);
  expect(goto.goal()).toContain(text);
  expect(goto.targets[0].tip()).toContain(text);
  expect(flatten(rank(commands(editor), text)).map((c) => c.id)).toContain(`node:${topic.id}`);
});
