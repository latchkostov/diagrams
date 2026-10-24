import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { NodePanel } from "./inspector/lazyNodePanel";
import { catalogs } from "virtual:i18n/catalogs";
import { state, t, type Catalog } from "../i18n";
import en from "../i18n/en";
import { Inspector, type InspectorProps } from "./Inspector";
import type { EditorApi } from "../editor/types";

// Resolve the browser-only download so the server render still checks the actual translated fields.
beforeAll(async () => {
  await NodePanel.ensureLoaded();
});

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

it.each(Object.keys(catalogs).filter((locale) => locale !== "en-XA"))(
  "provides resize instructions, spoken width and export wording in %s",
  async (locale) => {
    state.l = locale;
    state.c = (await catalogs[locale]()).default as Catalog;
    expect(t("inspector.resize")).not.toBe(en["inspector.resize"]);
    expect(t("inspector.resizeHint")).not.toBe(en["inspector.resizeHint"]);
    expect(t("inspector.widthValue", { width: 509 })).not.toBe("Inspector width, 509 pixels");
    expect(t("fileToast.exportingImage", { format: "PNG" })).not.toBe("Exporting PNG…");
  },
);

it.each(["ar", "en-XA"])("translates Inspector labels and keeps semantic modes stable in %s", async (locale) => {
  state.l = locale;
  state.c = (await catalogs[locale]()).default as Catalog;
  const props = {
    editor: {} as EditorApi,
    meta: { format: "diagrams/v1", title: "Invented diagram" },
    selectedNodes: [
      {
        id: "api",
        type: "diagram",
        position: { x: 0, y: 0 },
        data: { stencil: "generic.service", label: "Authored name" },
      },
    ],
    selectedGroups: [],
    selectedEdges: [],
    groups: [],
    nodeLabel: (id: string) => id,
    counts: { nodes: 1, edges: 0, groups: 0 },
    collapsed: false,
    onToggle: () => {},
  } as InspectorProps;
  const html = renderToStaticMarkup(<Inspector {...props} />);
  expect(html).toContain('data-inspector-mode="node"');
  expect(html).toContain(t("inspector.stencil"));
  expect(html).toContain(t("inspector.label"));
  expect(html).toContain(t("inspector.subtitle"));
  expect(html).toContain(t("inspector.boundary"));
  expect(html).toContain('value="Authored name"');
  expect(html).not.toContain(">Stencil<");
  expect(html).not.toContain(">Label<");
});
