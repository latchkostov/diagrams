// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { captureTypeAhead } from "../canvas/typeAhead";

const search = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  return { pending, release };
});
vi.mock("../lib/stencilDisplaySearch", async () => {
  await search.pending;
  return { scoreStencil: () => 1 };
});

it("a deferred pick completes naming outside React's effect flush", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const errors = vi.spyOn(console, "error");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const picked = vi.fn();
  let name: ReturnType<typeof captureTypeAhead> | undefined;
  try {
    await act(() =>
      root.render(
        <ContextMenu
          x={20}
          y={20}
          searchable="Search"
          query="topic"
          items={[
            {
              type: "item",
              id: "topic",
              label: "Topic",
              stencil: "kafka.topic",
              run: () => {
                name = captureTypeAhead(undefined, () => flushSync(picked));
              },
            },
          ]}
          onClose={() => {}}
        />,
      ),
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="context-menu-search"]');
    expect(input).not.toBeNull();
    await act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    search.release();
    await act(async () => vi.dynamicImportSettled());
    expect(picked).toHaveBeenCalledOnce();
    expect(errors.mock.calls).toEqual([]);
  } finally {
    search.release();
    name?.stop();
    await act(() => root.unmount());
    container.remove();
    errors.mockRestore();
    vi.unstubAllGlobals();
  }
});
