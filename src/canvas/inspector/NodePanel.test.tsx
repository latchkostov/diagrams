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

it.each([undefined, { name: "cache-add-rule", seq: 1 }])(
  "initial Live selection opens only a requested field (%j)",
  async (focus) => {
    const props = {
      node: { id: "cache", data: { stencil: "generic.cdn" } },
      editor: {},
      groups: [],
    } as unknown as ComponentProps<typeof NodePanel>;
    const host = document.createElement("div"),
      root = createRoot(host);
    try {
      await act(async () => root.render(<NodePanel {...props} focus={focus} />));
      expect(!!host.querySelector('[data-testid="requested-field"]')).toBe(!!focus);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
