import { describe, expect, it } from "vitest";
import { EXAMPLE_THEMES, groupByTheme, themeInfo, type ExampleTheme } from "./themes";
import { examples } from "./index";

const item = (slug: string, theme?: ExampleTheme) => ({ slug, theme });

describe("groupByTheme", () => {
  it("orders sections by EXAMPLE_THEMES, not by the order items arrive in", () => {
    const sections = groupByTheme(
      [item("r", "reliability"), item("c", "cloud"), item("s1", "streaming"), item("s2", "streaming")],
      (x) => x.theme,
    );
    expect(sections.map((s) => s.theme?.id)).toEqual(["streaming", "cloud", "reliability"]);
    expect(sections[0].items.map((x) => x.slug)).toEqual(["s1", "s2"]);
  });

  it("puts unthemed items first, in one section without a theme, and leaves out empty themes", () => {
    const sections = groupByTheme([item("d", "data"), item("u1"), item("u2")], (x) => x.theme);
    expect(sections.map((s) => s.theme?.id)).toEqual([undefined, "data"]);
    expect(sections[0].items.map((x) => x.slug)).toEqual(["u1", "u2"]);
  });

  it("identifies a section by its theme id, with the label only for display", () => {
    const [section] = groupByTheme([item("s", "streaming")], (x) => x.theme);
    expect(section.theme).toEqual({ id: "streaming", label: "Event streaming" });
    expect(section.theme).toBe(themeInfo("streaming"));
  });
});

describe("example themes", () => {
  it("gives every public example a declared theme, and every theme an example", () => {
    const publicExamples = examples.filter((ex) => !ex.localOnly);
    for (const ex of publicExamples) expect(ex.theme, ex.slug).toBeDefined();
    const used = new Set(publicExamples.map((ex) => ex.theme));
    expect(EXAMPLE_THEMES.filter((t) => !used.has(t.id))).toEqual([]);
  });
});
