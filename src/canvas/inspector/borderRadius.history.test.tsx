// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { editorHarness } from "../../test/editorHarness";
import { fromFlow, toFlow } from "../convert";
import type { AnnotationFlowNode, GroupFlowNode } from "../types";
import { HistoryController } from "../../editor/historyController";
import { MERGE_WINDOW_MS } from "../../editor/history";
import type { EditorRoom } from "../../editor/room";
import { GroupPanel } from "./GroupPanel";
import { AnnotationPanel } from "./AnnotationPanel";
import type { InspectorProps } from "./types";

it.each(["boundary", "zone"] as const)("%s slider transactions survive pauses locally and in rooms", async (kind) => {
  for (const collaborative of [false, true]) {
    const initial = kind === "boundary" ? 20 : 18;
    const h = editorHarness({
      format: "diagrams/v1",
      title: kind,
      nodes: [],
      edges: [],
      groups: [{ id: "b", label: kind, x: 0, y: 0, width: 400, height: 300 }],
      annotations: [{ id: "z", kind: "zone", text: kind, x: 500, y: 0, width: 400, height: 300 }],
    });
    let seq = 0;
    const roomCommit = vi.fn<EditorRoom["commit"]>(() => ({ status: "applied" as const }));
    const room = { newId: () => `step-${++seq}`, commit: roomCommit } as unknown as EditorRoom;
    const history = new HistoryController(toFlow(h.api.getDiagram()), 0, collaborative ? room : undefined);
    let merge: string | undefined;
    let at = 0;
    h.deps.history = {
      ...h.deps.history,
      hint: (tag) => {
        merge = tag;
      },
      begin: (tag) => history.begin(tag),
      end: (tag) => history.end(tag),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = () => {
      const groups = h.nodes().filter((n): n is GroupFlowNode => n.type === "boundary");
      const props: InspectorProps = {
        editor: h.api,
        meta: toFlow(h.api.getDiagram()).meta,
        selectedNodes: [],
        selectedEdges: [],
        selectedGroups: [],
        groups,
        nodeLabel: (id) => id,
        counts: { nodes: 0, edges: 0, groups: 1 },
        collapsed: false,
        onToggle: () => {},
      };
      root.render(
        kind === "boundary" ? (
          <GroupPanel {...props} group={groups[0]} />
        ) : (
          <AnnotationPanel {...props} note={h.nodes().find((n) => n.id === "z") as AnnotationFlowNode} />
        ),
      );
    };
    try {
      await act(render);
      const slider = host.querySelector<HTMLInputElement>('[data-testid="inspector-field-border-radius-slider"]')!;
      slider.setPointerCapture = vi.fn();
      const change = async (value: string) => {
        await act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, value);
          slider.dispatchEvent(new Event("input", { bubbles: true }));
        });
        at += MERGE_WINDOW_MS * 10;
        history.commit(toFlow(h.api.getDiagram()), merge, at);
        await act(render);
      };
      // A focused keyboard burst spans multiple native range changes and long pauses.
      await change("1");
      await change("39");
      await act(() => slider.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      if (collaborative) expect(new Set(roomCommit.mock.calls.map((call) => call[1]))).toHaveLength(1);
      else {
        expect(history.history.entries).toHaveLength(2);
        const undone = history.step("undo", { nodes: [], edges: [] })!;
        const diagram = fromFlow(undone.meta, undone.nodes, undone.edges);
        const radius = kind === "boundary" ? diagram.groups![0].borderRadius : diagram.annotations![0].borderRadius;
        expect(radius ?? initial).toBe(initial);
      }
      const previousTag = merge;
      roomCommit.mockClear();
      await act(() => slider.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })));
      await change("4");
      await change("34");
      await act(() => slider.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true })));
      expect(merge).not.toBe(previousTag);
      if (collaborative) expect(new Set(roomCommit.mock.calls.map((call) => call[1]))).toHaveLength(1);
      else expect(history.history.entries).toHaveLength(2);
    } finally {
      await act(() => root.unmount());
      host.remove();
    }
  }
});
