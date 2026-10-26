import { expect, it } from "vitest";
import css from "./tokens.css?raw";
import { readFileSync } from "node:fs";

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function themeTokens(block: string) {
  const declarations = [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)];
  const tokens = Object.fromEntries(declarations.map((match) => [match[1], match[2]]));
  for (const [key, value] of Object.entries(tokens))
    tokens[key] = value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => tokens[name]);
  return tokens;
}

const light = css.split('[data-theme="dark"]')[0];
const themes = [themeTokens(light), themeTokens(light + css.split('[data-theme="dark"]')[1])];

it("keeps Workbench frame labels at AA in both themes", () => {
  for (const tokens of themes)
    for (const [ink, surface] of [
      ["note", "panel"],
      ["bezel-ink", "bezel"],
      ["bezel-dim", "bezel"],
      ["rail-ink", "rail-bg"],
      ["rail-dim", "rail-bg"],
      ["live-ink", "live"],
      ["live-ink", "warning"],
    ]) {
      const a = luminance(tokens[ink]),
        b = luminance(tokens[surface]);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
});

it("keeps the rail and dock warning badges at AA in both themes", () => {
  for (const [path, selector] of [
    ["src/styles/canvas/tool-rail.css", "tool-rail-badge"],
    ["src/styles/canvas/inspector.css", "dock-tab-count"],
  ]) {
    const style = readFileSync(path, "utf8");
    const block = new RegExp("\\." + selector + " \\{([^}]+)\\}").exec(style)![1];
    const ink = /\n\s*color: var\(--([\w-]+)\)/.exec(block)![1];
    const fill = /\n\s*background: var\(--([\w-]+)\)/.exec(block)![1];
    for (const tokens of themes) {
      const a = luminance(tokens[ink]),
        b = luminance(tokens[fill]);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), selector).toBeGreaterThanOrEqual(4.5);
    }
  }
});
it("keeps readable secondary and muted text at AA on both themes' surfaces", () => {
  for (const block of [css.split('[data-theme="dark"]')[0], css.split('[data-theme="dark"]')[1]]) {
    const tokens = themeTokens(light + block);
    for (const ink of ["text-2", "text-3"])
      for (const surface of [
        "bg",
        "surface",
        "surface-2",
        "surface-3",
        "surface-raised",
        "node-bg",
        "stage-bg",
        "edge-label-bg",
      ]) {
        const a = luminance(tokens[ink]),
          b = luminance(tokens[surface]);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
  }
});

it("keeps dependency tints at 3:1 on the canvas and label pills in both themes", () => {
  for (const block of [css.split('[data-theme="dark"]')[0], css.split('[data-theme="dark"]')[1]]) {
    const tokens = themeTokens(light + block);
    for (const rel of ["config", "secret", "identity", "telemetry", "deploy", "depends"])
      for (const surface of ["bg", "stage-bg", "edge-label-bg", "node-bg"]) {
        const a = luminance(tokens[`rel-${rel}`]),
          b = luminance(tokens[surface]);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `rel-${rel} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
  }
});

it("keeps a highlighted context-menu hint at AA after compositing to display RGB", () => {
  const canvas = readFileSync("src/styles/canvas/context-menu.css", "utf8");
  const ink = /\.cm-hint \{[^}]*color: var\(--([\w-]+)\)/.exec(canvas)?.[1];
  expect(ink).toBeDefined();
  for (const [i, block] of [css.split('[data-theme="dark"]')[0], css.split('[data-theme="dark"]')[1]].entries()) {
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((m) => [m[1], m[2]]));
    const tint = /--accent-soft:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(block)!;
    const [r, g, b, alpha] = tint.slice(1).map(Number);
    // Light menus use surface; dark menus use surface-2 (canvas.css).
    const surface = tokens[i ? "surface-2" : "surface"];
    const under = [1, 3, 5].map((at) => parseInt(surface.slice(at, at + 2), 16));
    const mixed = [r, g, b].map((c, at) => Math.round(c * alpha + under[at] * (1 - alpha)));
    const background = `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    const a = luminance(tokens[ink!]),
      bg = luminance(background);
    expect((Math.max(a, bg) + 0.05) / (Math.min(a, bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});

it("keeps small warning words (the trace card's Kept and Waiting) at AA on the warning tint, in both themes", () => {
  const trace = readFileSync("src/styles/trace.css", "utf8");
  expect(trace).toMatch(/\.tr-status\.is-kept \{[^}]*color: var\(--warning-ink\)/);
  for (const block of [css.split('[data-theme="dark"]')[0], css.split('[data-theme="dark"]')[1]]) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((match) => [match[1], match[2]]),
    );
    const soft = /--warning-soft:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(block)!;
    const [r, g, b, alpha] = soft.slice(1).map(Number);
    for (const surface of ["surface", "surface-2", "surface-raised"]) {
      // The tint composited over the card's surface.
      const under = [1, 3, 5].map((i) => parseInt(tokens[surface].slice(i, i + 2), 16));
      const mixed = [r, g, b].map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha)));
      const hex = `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      const a = luminance(tokens["warning-ink"]),
        bg = luminance(hex);
      expect((Math.max(a, bg) + 0.05) / (Math.min(a, bg) + 0.05), `warning-ink on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
});

it("keeps selected text readable and its highlight visible over every field, in both themes", () => {
  for (const block of [css.split('[data-theme="dark"]')[0], css.split('[data-theme="dark"]')[1]]) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((match) => [match[1], match[2]]),
    );
    const ratio = (x: string, y: string) => {
      const a = luminance(tokens[x]),
        b = luminance(tokens[y]);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    // AAA for the selected words; the highlight itself clearly apart from what it's painted on (a browser's
    // default is about 1.45:1 on white).
    expect(ratio("selection-text", "selection-bg")).toBeGreaterThanOrEqual(7);
    for (const surface of ["bg", "surface", "surface-2", "surface-3", "surface-raised", "node-bg", "edge-label-bg"])
      expect(ratio("selection-bg", surface), `selection-bg on ${surface}`).toBeGreaterThanOrEqual(1.5);
  }
});

it("keeps spotlight dimmed strokes at 3:1 on the board", () => {
  for (const tokens of themes) {
    const a = luminance(tokens["dim-stroke"]),
      b = luminance(tokens.board);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
  }
});
