// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { captureTypeAhead, typeAheadActive } from "../canvas/typeAhead";

const metadata = vi.hoisted(() => ({ ready: false, failed: false, retry: vi.fn() }));
vi.mock("../i18n/useSurfaceCatalogs", () => ({ useSurfaceCatalogs: () => metadata }));
vi.mock("../lib/stencilDisplaySearch", () => ({ scoreStencil: () => 1 }));

afterEach(() => {
  metadata.ready = metadata.failed = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function menu() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const close = vi.fn();
  const picked = vi.fn();
  let name: ReturnType<typeof captureTypeAhead> | undefined;
  let placeholder = "Search";
  const render = () =>
    root.render(
      <ContextMenu
        x={20}
        y={20}
        searchable={placeholder}
        query="topic"
        onClose={close}
        items={[
          {
            type: "item",
            id: "topic",
            label: "Topic",
            stencil: "kafka.topic",
            run: () => {
              picked();
              name = captureTypeAhead();
            },
          },
        ]}
      />,
    );
  await act(async () => {
    render();
    await vi.dynamicImportSettled();
  });
  const input = document.querySelector<HTMLInputElement>('[data-testid="context-menu-search"]')!;
  const key = async (key: string, target: EventTarget = input) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };
  return {
    input,
    key,
    close,
    picked,
    name: () => name?.read(),
    update: () => act(render),
    translate: (text: string) => {
      placeholder = text;
      return act(render);
    },
    dispose: async () => {
      name?.stop();
      await act(() => root.unmount());
      container.remove();
    },
  };
}

it("a failed queued pick yields Tab and Enter to Retry and resumes its buffered name", async () => {
  const m = await menu();
  try {
    await m.key("Enter");
    for (const key of "Cache") await m.key(key);
    metadata.failed = true;
    await m.update();
    expect(typeAheadActive()).toBe(false);
    await m.key("Tab");
    const retry = document.querySelector<HTMLButtonElement>('[data-testid="context-menu-search-retry"]')!;
    expect(document.activeElement).toBe(retry);
    await m.key("Enter", retry);
    expect(metadata.retry).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(m.input);
    expect(typeAheadActive()).toBe(true);
    await m.key("!");
    await m.key("Enter");
    metadata.failed = false;
    metadata.ready = true;
    await m.update();
    expect(m.picked).toHaveBeenCalledOnce();
    expect(m.name()).toEqual({ text: "Cache!", done: "enter" });
  } finally {
    await m.dispose();
  }
});

it("translating a placed search keeps Enter with its focused field", async () => {
  metadata.ready = true;
  const m = await menu();
  try {
    expect(document.activeElement).toBe(m.input);
    expect(typeAheadActive()).toBe(false);
    await m.translate("Rechercher");
    expect(m.input.placeholder).toBe("Rechercher");
    await m.key("Enter");
    expect(m.picked).toHaveBeenCalledOnce();
    expect(m.close.mock.calls).toEqual([["pick"]]);
  } finally {
    await m.dispose();
  }
});

it("Escape clears a failed queued search and then dismisses without completing its pick", async () => {
  const m = await menu();
  try {
    await m.key("Enter");
    await m.key("x");
    metadata.failed = true;
    await m.update();
    await m.key("Escape");
    expect(m.input.value).toBe("");
    expect(m.picked).not.toHaveBeenCalled();
    await m.key("Escape");
    expect(m.close.mock.calls).toEqual([["escape"]]);
    metadata.ready = true;
    await m.update();
    expect(m.picked).not.toHaveBeenCalled();
  } finally {
    await m.dispose();
  }
});

it("a query change cancels a queued pick and releases its input capture", async () => {
  const m = await menu();
  try {
    await m.key("Enter");
    await m.key("x");
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(m.input, "");
      m.input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(m.input.value).toBe("");
    expect(typeAheadActive()).toBe(false);
    expect((await m.key("z")).defaultPrevented).toBe(false);
    await m.key("Escape");
    expect(m.close.mock.calls).toEqual([["escape"]]);
    metadata.ready = true;
    await m.update();
    expect(m.picked).not.toHaveBeenCalled();
  } finally {
    await m.dispose();
  }
});
