import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster } from "./Toaster";
import { toast } from "./toast";

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
