import { describe, expect, it } from "vitest";
import { presets, getPreset, DEFAULT_PRESET_ID } from "./presets";
import { defaultsOf, RESERVED_PARAMS } from "./controls";
import { diagramProblems } from "./generators";
import { LOOK_KEYS } from "./look";
import { PRESET_GROUPS } from "./types";
import { loadExample } from "../examples";

describe("lab preset registry", () => {
  it("has unique, URL-safe ids and a valid default", () => {
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(getPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it("covers every group", () => {
    for (const g of PRESET_GROUPS)
      expect(
        presets.some((p) => p.group === g),
        g,
      ).toBe(true);
  });

  it("control keys are unique per preset and don't collide with reserved or look params", () => {
    for (const p of presets) {
      const keys = (p.controls ?? []).map((c) => c.key);
      expect(new Set(keys).size, p.id).toBe(keys.length);
      for (const k of keys) {
        expect(RESERVED_PARAMS.has(k), `${p.id}.${k}`).toBe(false);
        expect((LOOK_KEYS as readonly string[]).includes(k), `${p.id}.${k}`).toBe(false);
      }
      for (const c of p.controls ?? [])
        if (c.type === "select")
          expect(
            c.options.some((o) => o.value === c.default),
            `${p.id}.${c.key}`,
          ).toBe(true);
    }
  });

  it("every diagram / scenario preset produces a valid diagram with default controls", async () => {
    for (const p of presets) {
      if (p.kind === "render") continue;
      if (p.kind === "diagram" && p.exampleSlug) await loadExample(p.exampleSlug);
      const d = p.diagram(defaultsOf(p.controls));
      expect(diagramProblems(d), p.id).toEqual([]);
    }
  });

  it("stress presets honour their node count", () => {
    for (const n of [10, 50, 150]) {
      const p = getPreset(`stress-${n}`)!;
      expect(p.kind).toBe("diagram");
      if (p.kind === "diagram") expect(p.diagram(defaultsOf(p.controls)).nodes).toHaveLength(n);
    }
  });
});
