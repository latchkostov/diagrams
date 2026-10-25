// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { editMessageProps, messageRules } from "../../model/messageRules";
import { CollabSession } from "../../collab/session";
import { CollaborativeEditorRoom } from "../../collab/editorRoom";
import { MemoryNetwork } from "../../collab/transport/memory";
import { roomFor } from "../../collab/transport/conformance";
import { FakeClock } from "../../collab/clock";
import { toFlow } from "../convert";
import { snapshotDiagram } from "../../editor/historySelection";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import { NodeMessages } from "./MessageFields";

vi.mock("./useMessageTypes", () => ({
  useMessageTypes: () => ({
    types: { arriving: new Map([["api", ["A", "B"]]]), known: new Set(["A", "B"]) },
  }),
}));

// The real TypePicker: its unfinished new-type draft is component state that only a stable row key preserves.
it("preserves an unfinished message-type draft across peer move and rename (R-a1637a0241)", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let diagram: DiagramFile = messageTypesFixture();
  diagram.nodes[1].props = { emits: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`T${i}`, `Out${i}`])) };
  const net = new MemoryNetwork();
  const clock = new FakeClock();
  const session = await CollabSession.open({
    room: roomFor(711),
    transport: net.connect(),
    initial: diagram,
    privacy: {},
    clock,
  });
  const peer = await CollabSession.open({ room: roomFor(711), transport: net.connect(), privacy: {}, clock });
  const settle = () =>
    net.settle(async () => {
      await session.idle();
      await peer.idle();
    });
  await settle();
  const room = new CollaborativeEditorRoom(session, () => ({}));
  const disconnect = room.connect({
    getSnapshot: () => toFlow(diagram),
    flushPending: () => true,
    receive: (snapshot) => {
      diagram = snapshotDiagram(snapshot);
    },
  });
  const editor = {
    getDiagram: () => diagram,
    setNodeProps: (_id: string, props: Record<string, unknown>) => {
      diagram = {
        ...diagram,
        nodes: diagram.nodes.map((node) =>
          node.id === "api" ? { ...node, props: editMessageProps(props, node.props ?? {}) } : node,
        ),
      };
      expect(room.commit(toFlow(diagram)).status).toBe("applied");
    },
  } as unknown as EditorApi;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () => root.render(<NodeMessages nodeId="api" editor={editor} source={false} />);
  const find = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  try {
    await act(render);
    // Append past the 25-row page, then open the appended row's new-type input and type without committing.
    await act(async () => {
      find("inspector-emits-add")!.click();
      await settle();
      render();
    });
    const appended = messageRules(diagram.nodes[1].props?.emits).at(-1)!;
    expect(find("inspector-emits-row-26")).not.toBeNull();
    await act(async () => find("inspector-field-sends-26")!.click());
    await act(async () => find("context-menu-item-new")!.click());
    const input = find("inspector-sends-26-new") as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unfinished");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // A peer moves and renames the processor: room projection deep-copies the rules.
    const priorEmits = diagram.nodes[1].props?.emits;
    for (const label of ["Moved", "Renamed"]) {
      await act(async () => {
        const x = peer.doc.project().diagram!.nodes[1].x + 10;
        expect(peer.doc.apply([{ op: "patch", kind: "nodes", id: "api", set: { x, label } }])).toEqual({ ok: true });
        await settle();
        room.flushRemote();
        render();
      });
      expect(diagram.nodes[1]).toMatchObject({ label });
    }
    expect(diagram.nodes[1].props?.emits).not.toBe(priorEmits);
    const draft = find("inspector-sends-26-new") as HTMLInputElement;
    expect(draft).toBe(input);
    expect(draft.value).toBe("Unfinished");
    expect(document.activeElement).toBe(draft);
    // Committing the draft edits the same rule.
    await act(async () => {
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
      render();
    });
    const rules = messageRules(diagram.nodes[1].props?.emits);
    expect(rules.at(-1)).toMatchObject({ id: appended.id, sends: "Unfinished" });
  } finally {
    await act(() => root.unmount());
    host.remove();
    disconnect();
    await Promise.all([session.leave(), peer.leave()]);
    session.doc.destroy();
    peer.doc.destroy();
    vi.unstubAllGlobals();
  }
});
