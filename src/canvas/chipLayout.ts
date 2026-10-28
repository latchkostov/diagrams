import type { Rect } from "./geometry/rect";
import type { ChipLayout } from "./lowZoom";
import { SpatialGrid } from "./geometry/spatial";

const abbreviations: Record<string, string> = {
  Recommendations: "Recs",
  Recommendation: "Rec",
  Notifications: "Notifs",
  Notification: "Notif",
  Configuration: "Config",
  Application: "App",
  Applications: "Apps",
  Management: "Mgmt",
  Production: "Prod",
  Database: "DB",
  Authentication: "Auth",
  Environment: "Env",
  Kubernetes: "K8s",
  Promotions: "Promos",
  Evaluation: "Eval",
  Experiments: "Expts",
  Operational: "Ops",
  Information: "Info",
};
const filler = new Set(["and", "the", "of", "for", "on", "to", "a", "an", "with", "by", "in"]);
export type ChipInput = Rect & { id: string; label: string };

/** Cached glyph widths belong to a font, not a node or a simulation tick. */
export function chipMeasurer(measure: (text: string, font: number) => number) {
  const widths = new Map<string, number>();
  return (text: string, font: number) => {
    const key = `${font}|${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (widths.size >= 8192) widths.clear();
      widths.set(key, (width = measure(text, font) + 1.5));
    }
    return width;
  };
}

function wrap(text: string, width: number, font: number, measure: (s: string, font: number) => number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (measure(word, font) > width) return null;
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font) <= width) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length <= 2 && lines.length ? lines : null;
}

export function fitChip(
  label: string,
  widths: number[],
  far: boolean,
  measure: (s: string, font: number) => number,
  height = Infinity,
) {
  // Bound shaping work for imported labels, keeping every displayed word intact.
  const words = label.trim().split(/\s+/u).slice(0, 64);
  const full = words.join(" ");
  const lean = words.filter((w, i) => !i || !filler.has(w.toLowerCase()));
  const abbr = (s: string) =>
    s
      .split(" ")
      .map((w) => abbreviations[w] ?? w)
      .join(" ");
  const candidates = [...new Set([full, abbr(full), lean.join(" "), abbr(lean.join(" "))])];
  const sizes = far ? [11.5, 11, 10.5] : [12, 11.5, 11, 10.5];
  const tryFit = (text: string, font: number) => {
    const width = measure(text, font);
    if (widths.some((w) => width <= w) && font * 1.2 + (far ? 6 : 8) <= height) return { lines: text, font, width };
    for (const width of widths) {
      const lines = wrap(text, width, font, measure);
      if (lines && lines.length * font * 1.2 + (far ? 6 : 8) <= height)
        return { lines: lines.join("\n"), font, width: Math.max(...lines.map((l) => measure(l, font))) };
    }
    return null;
  };
  for (const font of sizes)
    for (const text of candidates) {
      const fit = tryFit(text, font);
      if (fit) return fit;
    }
  for (let n = lean.length - 1; n > 0; n--) {
    const fit = tryFit(abbr(lean.slice(0, n).join(" ")), 10.5);
    if (fit) return fit;
  }
  // A single long word is still a name: retain it whole, with the full accessible name on the chip.
  const first = words[0] || label || "?";
  return { lines: first, font: 10.5, width: measure(first, 10.5) };
}

export function layoutChips(nodes: ChipInput[], zoom: number, measure: (s: string, font: number) => number) {
  const far = zoom < 0.3;
  const icon = far ? 12 : 14;
  const chrome = far ? 30 : 38;
  const result = new Map<string, ChipLayout>();
  const index = new SpatialGrid<ChipInput>();
  for (const node of nodes) index.insert(node, node);
  for (const n of nodes) {
    const f = { x: n.x * zoom, y: n.y * zoom, width: n.width * zoom, height: n.height * zoom };
    let left = 26,
      right = 26,
      up = 9,
      down = 9;
    for (const { item: other } of index.query({
      x: n.x - 52 / zoom,
      y: n.y - 18 / zoom,
      width: n.width + 104 / zoom,
      height: n.height + 36 / zoom,
    })) {
      if (other === n) continue;
      const g = { x: other.x * zoom, y: other.y * zoom, width: other.width * zoom, height: other.height * zoom };
      if (Math.min(f.y + f.height, g.y + g.height) - Math.max(f.y, g.y) > -18) {
        if (g.x >= f.x + f.width) right = Math.min(right, (g.x - f.x - f.width) / 2 - 3);
        if (g.x + g.width <= f.x) left = Math.min(left, (f.x - g.x - g.width) / 2 - 3);
      }
      if (Math.min(f.x + f.width, g.x + g.width) - Math.max(f.x, g.x) > -52) {
        if (g.y >= f.y + f.height) down = Math.min(down, (g.y - f.y - f.height) / 2 - 3);
        if (g.y + g.height <= f.y) up = Math.min(up, (f.y - g.y - g.height) / 2 - 3);
      }
    }
    const available = f.width + Math.max(0, left) + Math.max(0, right);
    const fit = fitChip(
      n.label,
      [Math.max(20, f.width - chrome), Math.max(20, available - chrome)],
      far,
      measure,
      f.height + Math.max(0, up) + Math.max(0, down),
    );
    const width = Math.max(f.width, chrome + fit.width);
    const height = Math.max(24, fit.lines.split("\n").length * fit.font * 1.2 + (far ? 6 : 8));
    result.set(n.id, {
      x: Math.min(0, Math.max(-Math.max(0, left), f.width + Math.max(0, right) - width)) / zoom,
      y: Math.max(-Math.max(0, up), Math.min((f.height - height) / 2, f.height + Math.max(0, down) - height)) / zoom,
      width: width / zoom,
      height: height / zoom,
      lines: fit.lines,
      font: fit.font / zoom,
      icon: icon / zoom,
      natural: { width: n.width, height: n.height },
    });
  }
  return result;
}

/** A header uses the clear band first, otherwise a tab outside the zone. */
export function chipTitles(
  nodes: ChipInput[],
  chips: Map<string, ChipLayout>,
  zones: ChipInput[],
  zoom: number,
  measure: (s: string, font: number) => number,
  live: boolean,
) {
  const boxes: Rect[] = nodes.map((n) => {
    const c = chips.get(n.id)!;
    return { x: (n.x + c.x) * zoom, y: (n.y + c.y) * zoom, width: c.width * zoom, height: c.height * zoom };
  });
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + 2 && b.x < a.x + a.width + 2 && a.y < b.y + b.height + 2 && b.y < a.y + a.height + 2;
  const titles = new Map<string, { x: number; y: number }>();
  for (const zone of zones) {
    const x = zone.x * zoom,
      y = zone.y * zoom,
      w = zone.width * zoom,
      h = zone.height * zoom;
    const width = measure(zone.label, 11.5) + 12 + (live ? 160 : 0);
    const candidates = [
      { x: 10, y: 8 },
      { x: 0, y: -22 },
      { x: w - width, y: -22 },
      { x: 0, y: h + 2 },
    ];
    for (let row = 1; row < 24; row++) candidates.push({ x: 0, y: -22 - row * 22 });
    const spot =
      candidates.find((p) => !boxes.some((b) => overlap({ x: x + p.x, y: y + p.y, width, height: 18 }, b))) ??
      candidates.at(-1)!;
    titles.set(zone.id, spot);
    boxes.push({ x: x + spot.x, y: y + spot.y, width, height: 18 });
  }
  return titles;
}
