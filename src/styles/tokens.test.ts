import { expect, it } from "vitest";
import css from "./tokens.css?raw";

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
it("keeps readable secondary and muted text at AA on both themes' surfaces", () => {
  for (const block of [css.split('[data-theme="dark"]')[0], css.split('[data-theme="dark"]')[1]]) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((match) => [match[1], match[2]]),
    );
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
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((match) => [match[1], match[2]]),
    );
    for (const rel of ["config", "secret", "identity", "telemetry", "deploy", "depends"])
      for (const surface of ["bg", "stage-bg", "edge-label-bg", "node-bg"]) {
        const a = luminance(tokens[`rel-${rel}`]),
          b = luminance(tokens[surface]);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `rel-${rel} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
  }
});
