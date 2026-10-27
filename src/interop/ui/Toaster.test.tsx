import { toast as interaction } from "./toastRuntime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster } from "./Toaster";
import { toast } from "./toast";
import { openModalLayer } from "../../lib/modalLayers";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));
afterEach(() => {
  toast.dismiss();
  vi.unstubAllGlobals();
});

it("replaces the loading spinner with one determinate indicator", () => {
  vi.stubGlobal("document", { body: {} });
  const id = toast.busy("Exporting PNG…");
  expect(renderToStaticMarkup(<Toaster />)).toContain('data-testid="toast-icon"');
  toast.progress(id, 0.15);
  const html = renderToStaticMarkup(<Toaster />);
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="15"');
  expect(html).not.toContain('data-testid="toast-icon"');
});

it("gives every toast button a non-submitting type", () => {
  vi.stubGlobal("document", { body: {} });
  toast.info("Undo", { action: { label: "Undo", run() {} } });
  const buttons = renderToStaticMarkup(<Toaster />).match(/<button\b[^>]*>/g);
  expect(buttons).toHaveLength(2);
  for (const button of buttons!) expect(button).toContain('type="button"');
});

it("announces a consumed modal opener action as disabled while keeping it focusable", () => {
  vi.stubGlobal("document", { body: {} });
  const id = toast.info("Restore", { action: { label: "Undo", run() {} } });
  interaction.contact("focus", true, id);
  const opener = { closest: () => ({ dataset: { toastId: String(id) } }) } as unknown as HTMLElement;
  const close = openModalLayer({} as HTMLElement, { opener });
  try {
    toast.dismiss(id);
    const buttons = renderToStaticMarkup(<Toaster />).match(/<button\b[^>]*>/g)!;
    expect(buttons[0]).toContain('aria-disabled="true"');
    expect(buttons[0]).not.toMatch(/\sdisabled(?:=|\s|>)/);
  } finally {
    close();
    interaction.release();
  }
});
