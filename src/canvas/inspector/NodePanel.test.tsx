// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { act, type ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { NodePanel } from "./NodePanel";

vi.mock("../../planning/host", () => ({ planningHost: { subscribe: () => () => {}, get: () => ({}) } }));
vi.mock("../../planning/lazy", () => ({ NodePlanning: () => null }));
vi.mock("./lazyNodeIdentity", () => ({ NodeIdentity: () => null }));
// Observe whether the editing surface can mount, independently of its download.
vi.mock("./lazyNodeSettings", () => ({
  NodeSettings: () => <div data-testid="requested-field" />,
}));

it.each([
  { focus: undefined, stencil: "generic.cdn", settings: false },
  { focus: { name: "cache-add-rule", seq: 1 }, stencil: "generic.cdn", settings: true },
  { focus: { name: "label", seq: 1 }, stencil: "generic.service", settings: false },
  { focus: { name: "cache-add-rule", seq: 1 }, stencil: "generic.service", settings: false },
])("initial Live selection reveals only requested cache fields (%j)", async ({ focus, stencil, settings }) => {
  const props = {
    node: { id: "cache", data: { stencil } },
    editor: {},
    groups: [],
  } as unknown as ComponentProps<typeof NodePanel>;
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<NodePanel {...props} focus={focus} />));
    expect(!!host.querySelector('[data-testid="requested-field"]')).toBe(settings);
  } finally {
    await act(async () => root.unmount());
  }
});
