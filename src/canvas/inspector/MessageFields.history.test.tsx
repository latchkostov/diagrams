// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import { NodeMessages } from "./MessageFields";

vi.mock("./useMessageTypes", () => ({
  useMessageTypes: () => ({
    types: { arriving: new Map([["api", ["A", "B", "C", "D"]]]), known: new Set(["A", "B", "C", "D"]) },
  }),
}));

// Exercise the mounted row editor and its callbacks without testing the dropdown's separate focus lifecycle.
vi.mock("../../components/MessageTypePicker", () => ({
  TypePicker: ({ name, value, onChange }: { name: string; value: string[]; onChange: (v: string[]) => void }) => (
    <select data-testid={`inspector-field-${name}`} value={value[0]} onChange={(e) => onChange([e.target.value])}>
      {[...new Set([...value, "A", "B", "C", "D", "Renamed", "Edited"])].map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  ),
}));

type Rule = { input: string; output: string; appended: boolean };
type Event = "add" | "rename" | "renameFirst" | "edit" | "editFirst" | "undo" | "redo" | "remove";
const sequences: Event[][] = [
  ["add", "add", "undo", "redo", "editFirst", "edit", "undo", "redo"],
  ["add", "rename", "undo", "renameFirst", "edit", "undo", "undo", "redo", "redo"],
  ["add", "add", "rename", "undo", "undo", "redo", "redo", "edit"],
  ["add", "add", "undo", "rename", "add", "edit", "undo", "redo"],
  ["add", "add", "add", "undo", "undo", "undo", "redo", "redo", "redo"],
  ["add", "add", "remove", "undo", "redo", "undo", "rename", "undo", "redo"],
];

it.each([26, 2_000].flatMap((size) => sequences.map((events) => ({ size, events }))))(
  "keeps appended rows editable through $events with $size imported rules",
  async ({ size, events }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let diagram = messageTypesFixture();
    const initial = Array.from({ length: size }, (_, i) => ({ input: `T${i}`, output: `Out${i}`, appended: false }));
    const model: Rule[][] = [initial];
    const snapshots: DiagramFile[] = [];
    let position = 0;
    const emitsOf = (rules: Rule[]) => Object.fromEntries(rules.map(({ input, output }) => [input, output]));
    diagram.nodes[1].props = { emits: emitsOf(initial) };
    snapshots.push(diagram);
    const editor = {
      getDiagram: () => diagram,
      setNodeProps: (_id: string, props: Record<string, unknown>) => {
        diagram = { ...diagram, nodes: diagram.nodes.map((node) => (node.id === "api" ? { ...node, props } : node)) };
        snapshots.splice(position + 1, Infinity, diagram);
      },
    } as unknown as EditorApi;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = () => root.render(<NodeMessages nodeId="api" editor={editor} source={false} />);
    const control = (id: string) => {
      const element = host.querySelector<HTMLSelectElement>(`[data-testid="${id}"]`);
      expect(element, id).not.toBeNull();
      return element!;
    };
    const change = (name: string, value: string) => {
      const select = control(`inspector-field-${name}`);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    try {
      await act(render);
      for (const event of events) {
        const current = model[position];
        const last = current.map((rule) => rule.appended).lastIndexOf(true);
        const next = current.map((rule) => ({ ...rule }));
        await act(() => {
          if (event === "undo" || event === "redo") {
            position += event === "undo" ? -1 : 1;
            expect(position).toBeGreaterThanOrEqual(0);
            expect(position).toBeLessThan(snapshots.length);
            diagram = snapshots[position];
          } else {
            if (event === "add") {
              const input = ["A", "B", "C", "D"].find((key) => !current.some((rule) => rule.input === key))!;
              next.push({ input, output: input, appended: true });
              control("inspector-emits-add").click();
            } else if (event === "remove") {
              next.splice(last, 1);
              control(`inspector-emits-remove-${last}`).click();
            } else {
              const index =
                event === "renameFirst" ? 0 : event === "editFirst" ? current.findIndex((rule) => rule.appended) : last;
              const editing = event === "edit" || event === "editFirst";
              if (editing) next[index].output = "Edited";
              else next[index].input = "Renamed";
              change(`${editing ? "sends" : "receives"}-${index}`, next[index][editing ? "output" : "input"]);
            }
            model.splice(position + 1, Infinity, next);
            position++;
          }
          render();
        });
        const expected = model[position];
        expect(diagram.nodes[1].props?.emits).toEqual(emitsOf(expected));
        const appended = expected.filter((rule) => rule.appended);
        expect(host.querySelectorAll('[data-testid^="inspector-emits-row-"]').length).toBe(25 + appended.length);
        for (const rule of appended) {
          const index = expected.indexOf(rule);
          const receives = control(`inspector-field-receives-${index}`);
          const sends = control(`inspector-field-sends-${index}`);
          expect(receives.value).toBe(rule.input);
          expect(sends.value).toBe(rule.output);
          expect(receives.disabled || sends.disabled).toBe(false);
        }
      }
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);
