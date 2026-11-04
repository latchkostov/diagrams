// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NodeIdentity } from "./NodeIdentity";
import { Icon } from "../../components/Icon";
import { getStencil } from "../../stencils/registry";

vi.mock("../../components/Icon", async (original) => {
  const actual = await original<typeof import("../../components/Icon")>();
  // Observe parent reconciliation even though the real Icon has its own memo boundary.
  return { ...actual, Icon: vi.fn((props: ComponentProps<typeof actual.Icon>) => <actual.Icon {...props} />) };
});
vi.mock("../../components/markdown/lazy", () => ({ MarkdownEditor: () => null }));

it("leaves the Description disclosure out of label and subtitle renders, but updates description edits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const labels = ["API", "API x", "API xy"] as const;
  const props = {
    node: { id: "api", data: { stencil: "generic.service", label: labels[0] } },
    stencil: getStencil("generic.service"),
    editor: {},
    groups: [],
    naming: { merge: () => ({}) },
    nameKeys: {},
    setPicker: vi.fn(),
    onDescriptionFocus: vi.fn(),
    onDescriptionBlur: vi.fn(),
  } as unknown as ComponentProps<typeof NodeIdentity>;
  try {
    await act(async () => root.render(<NodeIdentity {...props} />));
    const disclosure = host.querySelector<HTMLDetailsElement>('[data-testid="inspector-node-description"]')!;
    expect(disclosure.open).toBe(false);
    // A user's native toggle must survive unrelated edits and typing/clearing the description.
    disclosure.open = true;
    vi.mocked(Icon).mockClear();
    for (const patch of [{ label: labels[1] }, { sublabel: "Service" }, { label: labels[2] }]) {
      props.node = { ...props.node, data: { ...props.node.data, ...patch } };
      await act(async () => root.render(<NodeIdentity {...props} />));
    }
    expect(Icon).not.toHaveBeenCalled();
    for (const description of ["Documentation", ""]) {
      vi.mocked(Icon).mockClear();
      props.node = { ...props.node, data: { ...props.node.data, description } };
      await act(async () => root.render(<NodeIdentity {...props} />));
      expect(Icon).toHaveBeenCalledOnce();
      expect(disclosure.open).toBe(true);
      expect(disclosure.textContent).toContain(description ? "Description" : "Add description…");
    }
  } finally {
    await act(async () => root.unmount());
  }
});
