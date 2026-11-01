// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PaletteDialog } from "./PaletteDialog";
import { paletteHost, publish } from "./host";
import type { Command } from "./rank";

const source = vi.hoisted(() => ({ commands: [] as Command[] }));

vi.mock("./sources", () => ({
  collectCommands: () => source.commands,
}));

it("keeps the keyboard's highlighted command when the canvas context republishes", async () => {
  source.commands = ["First", "Second", "Third"].map((label) => ({
    id: `action:${label.toLowerCase()}`,
    label,
    group: "actions",
    idle: true,
  }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(<PaletteDialog view="canvas" diagrams={[]} onOpenDiagram={() => {}} onClose={() => {}} />),
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="command-input"]');
    if (!input) throw new Error("Missing palette search");
    const active = (id: string) =>
      document.querySelector(`[data-testid="command-item-action:${id}"]`)?.getAttribute("data-active");
    await act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(active("second")).toBe("true");
    await act(() => {
      publish("session", { run: () => {} });
    });
    expect(active("second")).toBe("true");
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setValue) throw new Error("Missing native text setter");
      setValue.call(input, "First");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(active("first")).toBe("true");
  } finally {
    await act(() => root.unmount());
    host.remove();
    paletteHost.reset();
    vi.unstubAllGlobals();
  }
});

it("retains a moved command by identity, runs its refreshed action, and falls back when it disappears", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const oldAction = vi.fn();
  const refreshedAction = vi.fn();
  source.commands = ["First", "Second", "Third"].map((label) => ({
    id: `action:${label.toLowerCase()}`,
    label,
    group: "actions",
    idle: true,
    run: oldAction,
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(<PaletteDialog view="canvas" diagrams={[]} onOpenDiagram={() => {}} onClose={() => {}} />),
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="command-input"]')!;
    const active = () =>
      [...document.querySelectorAll('[data-testid^="command-item-"]')]
        .find((item) => item.getAttribute("data-active") === "true")
        ?.getAttribute("data-testid");
    const key = async (key: string) =>
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    await key("ArrowDown");
    expect(active()).toBe("command-item-action:second");
    await act(() => {
      source.commands = [
        source.commands[2],
        source.commands[0],
        { ...source.commands[1], label: "Second refreshed", run: refreshedAction },
      ];
      publish("session", { run: () => {} });
    });
    expect(active()).toBe("command-item-action:second");
    await key("Enter");
    await act(() => vi.runAllTimers());
    expect(refreshedAction).toHaveBeenCalledOnce();
    expect(oldAction).not.toHaveBeenCalled();
    await act(() => {
      source.commands = source.commands.filter((command) => command.id !== "action:second");
      publish("session", { run: () => {} });
    });
    expect(active()).toBe("command-item-action:third");
  } finally {
    await act(() => root.unmount());
    host.remove();
    paletteHost.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
