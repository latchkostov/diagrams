import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Palette } from "./Palette";

afterEach(() => vi.unstubAllGlobals());

it.each(["getter", "read"])("renders default palette controls when the storage %s is blocked", (failure) => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new DOMException("Storage blocked", "SecurityError");
    },
  });
  if (failure === "getter")
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  const html = renderToString(<Palette collapsed={false} onToggle={() => undefined} onAdd={() => undefined} />);
  expect(html).toContain('data-testid="palette-family"');
  expect(html).toContain('<option value="all" selected=""');
  expect(html).toContain('data-testid="palette-search"');
});
