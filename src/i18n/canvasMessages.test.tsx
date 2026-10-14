import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { catalogs } from "virtual:i18n/catalogs";
import { state, t, type Catalog } from "./index";
import { categoryLabel, shapeLabel } from "./chrome";
import { FirstRunHint } from "../canvas/FirstRunHint";
import { Palette } from "../canvas/Palette";
import { GalleryView } from "../gallery/GalleryView";
import { SettingsProvider } from "../harness/SettingsProvider";
import * as stencilRegistry from "../stencils/registry";
import { ActionRegistry, builtinSections, type MenuItem } from "../editor/actions";
import { builtinActions, quickAddMenu } from "../editor/builtinActions";
import { actionCommands, paletteLabel, stencilScore } from "../palette/sources";
import { relationChangeMessage } from "../editor/editMessages";
import { relationChangeText, type RelationChange } from "../stencils/relations";
import en from "./en";
import { getStencil } from "../stencils/registry";
import type { EditorApi } from "../editor/types";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
  vi.restoreAllMocks();
});

it.each(Object.keys(catalogs).filter((code) => code !== "en-XA"))(
  "%s: every canvas-chrome message is present without translation transport artifacts",
  (code) => {
    const messages = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, "utf8")) as Record<string, string>;
    for (const key of Object.keys(en).filter((key) =>
      /^(menu|command|chrome|gallery|edit|canvas|library)\./.test(key),
    )) {
      expect(messages[key], `${code}: ${key}`).toBeTypeOf("string");
      expect(messages[key], `${code}: ${key}`).not.toMatch(/ZXQ|QXZ|\[\d{4}\]|\n/);
    }
  },
);

it.each(Object.keys(catalogs))("%s: a stencil's complete Add command remains searchable", async (code) => {
  state.l = code;
  state.c = (await catalogs[code]()).default as Catalog;
  const stencil = getStencil("postgres");
  expect(stencilScore(stencil, t("chrome.addValue", { name: stencil.label }))).toBeGreaterThan(0);
  expect(stencilScore(stencil, "add PostgreSQL")).toBeGreaterThan(0);
});

describe("original English canvas chrome", () => {
  it("preserves the zone's palette noun using annotation metadata", () => {
    const item: MenuItem = { type: "item", id: "annotation.edit", label: "Rename" };
    const registry = { build: () => [item] };
    const editor = { getAnnotation: () => ({ kind: "zone" }) } as unknown as EditorApi;
    const [command] = actionCommands(registry, [
      { target: "annotation", nodeId: "zone", selection: { nodeIds: ["zone"], edgeIds: [], groupIds: [] }, editor },
    ]);
    expect(command.label).toBe("Rename annotation");
    expect(paletteLabel({ ...item, label: "Edit text" }, "annotation", "note")).toBe("Edit text");
  });

  it("preserves the footer's complete English sentence and keyboard markup", () => {
    const html = renderToStaticMarkup(<Palette collapsed={false} onToggle={() => {}} onAdd={() => {}} />);
    const footer = html.match(/<div class="palette-foot">(.*?)<\/div>/)?.[1];
    expect(footer).toBe(
      "Drag onto the canvas or click to add. <kbd>Ctrl+K</kbd> finds anything; <kbd>?</kbd> lists shortcuts.",
    );
  });

  it("retains menu categories, shapes and palette nouns", () => {
    expect(Object.values(categoryLabel)).toEqual([
      "Messaging",
      "Compute",
      "Data",
      "Network",
      "On-prem network",
      "Observability",
      "Security & config",
      "Clients & external",
      "Generic",
    ]);
    expect(Object.values(shapeLabel)).toEqual(["Rectangle", "Rounded rectangle", "Ellipse", "Diamond", "Cylinder"]);
    const item: MenuItem = { type: "item", id: "item.delete", label: "Delete" };
    expect(paletteLabel(item, "group")).toBe("Delete boundary");
    expect(paletteLabel({ ...item, id: "node.properties" }, "edge")).toBe("Edge properties");
    expect(paletteLabel({ ...item, id: "sim.kill", label: "Kill" }, "node")).toBe("Kill node");
    expect(paletteLabel({ ...item, id: "sim.kill", label: "Revive" }, "node")).toBe("Revive node");
  });

  it("retains every singular, plural and mixed stencil-change toast", () => {
    for (const count of [1, 2, 1000]) {
      for (const to of ["flow", "config", "secret", "identity", "telemetry", "deploy", "depends"] as const) {
        const changes: RelationChange[] = Array.from({ length: count }, (_, i) => ({ id: `e${i}`, from: "flow", to }));
        expect(relationChangeMessage(changes)).toBe(relationChangeText(changes));
      }
    }
    for (const changes of [
      [],
      [
        { id: "a", from: "flow", to: "config" },
        { id: "b", from: "flow", to: "secret" },
      ],
      [
        { id: "a", from: "config", to: "flow" },
        { id: "b", from: "flow", to: "secret" },
      ],
    ] as RelationChange[][])
      expect(relationChangeMessage(changes)).toBe(relationChangeText(changes));
  });

  it("keeps count-invariant wording and ungrouped counts", () => {
    expect(t("chrome.deleteValueItemsOtherValueItems", { count: 1 })).toBe("Delete 1 items");
    expect(t("chrome.deleteValueItemsOtherValueItems", { count: 1000 })).toBe("Delete 1000 items");
    expect(t("chrome.addedValueOtherValueNodesToValue", { count: 1, name: "Orders" })).toBe("Added 1 node to Orders");
    expect(t("chrome.addedValueOtherValueNodesToValueAndTookValue", { count: 2, name: "Orders", released: 1000 })).toBe(
      "Added 2 nodes to Orders and took 1000 out",
    );
  });
});

it("pseudo-locale treats the rail's keyboard teaching sentence as one message", async () => {
  state.l = "en-XA";
  state.c = (await catalogs["en-XA"]()).default as Catalog;
  const html = renderToStaticMarkup(<Palette collapsed={false} onToggle={() => {}} onAdd={() => {}} />);
  const footer = html.match(/<div class="palette-foot">(.*?)<\/div>/)?.[1];
  // The complete sentence and the localized Ctrl key each have one pair of brackets.
  expect(footer?.match(/\[/g)).toHaveLength(2);
  expect(footer?.match(/\]/g)).toHaveLength(2);
  expect(footer).toMatch(/^\[.*<kbd>.*<\/kbd>.*<kbd>\?<\/kbd>.*\]$/);
});

it("localizes the gallery's missing-icon count inside its complete message", async () => {
  vi.spyOn(stencilRegistry, "iconUrl").mockReturnValue(undefined);
  state.l = "en-XA";
  state.c = (await catalogs["en-XA"]()).default as Catalog;
  const html = renderToStaticMarkup(
    <SettingsProvider>
      <GalleryView />
    </SettingsProvider>,
  );
  const warning = html.match(/<span class="warn">(.*?)<\/span>/)?.[1];
  const count = stencilRegistry.stencils.length;
  expect(warning).toMatch(new RegExp(`^\\[ ${count} .*\\]$`));
});

it.each(["de", "ar", "en-XA"])("%s: cached actions and metadata resolve at display time", async (code) => {
  const registry = new ActionRegistry(builtinSections);
  registry.register(builtinActions());
  const editor = {
    getDiagram: () => ({ nodes: [], edges: [] }),
    getSelection: () => ({ nodeIds: [], edgeIds: [], groupIds: [] }),
  } as unknown as EditorApi;
  const context = {
    target: "node" as const,
    nodeId: "orders",
    selection: { nodeIds: ["orders"], edgeIds: [], groupIds: [] },
    editor,
  };
  const original = registry.build(context).find((n) => n.type === "item" && n.id === "node.rename") as MenuItem;
  expect(original.label).toBe("Rename");
  state.l = code;
  state.c = (await catalogs[code]()).default as Catalog;
  const translated = registry.build(context).find((n) => n.type === "item" && n.id === "node.rename") as MenuItem;
  expect(translated.label).not.toBe("Rename");
  expect(paletteLabel(translated, "node")).not.toBe("Rename node");
  expect(categoryLabel.messaging).not.toBe("Messaging");
  expect(quickAddMenu(() => {})[0]).toMatchObject({ label: categoryLabel.messaging });
  // The SSR-based palette tests use this hook too; no component-specific locale mock is needed.
  expect(renderToStaticMarkup(<FirstRunHint simulations={2} onDismiss={() => {}} />)).not.toContain("Dismiss tip");
  if (code === "de")
    expect(stencilScore(getStencil("postgres"), "Hinzufügen PostgreSQL")).toBe(
      stencilScore(getStencil("postgres"), "add PostgreSQL"),
    );
});
