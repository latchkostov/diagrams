// Renders a sequence model as a standalone SVG string: the same markup is shown in the app and
// downloaded, so what you see is what you export. Pure (no DOM): colours come from a theme built
// from the design tokens, and text widths from an optional measure function.

import { messageColor } from "../sim/colors";
import { formatOffset } from "./journey";
import type { ArrowStyle, SequenceArrow, SequenceModel } from "./sequence";

export interface SequenceTheme {
  name: "light" | "dark";
  background: string;
  surface: string;
  line: string;
  lineStrong: string;
  text: string;
  text2: string;
  text3: string;
  band: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  font: string;
  mono: string;
}

const FONT = `"Mona Sans Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
const MONO = `"Geist Mono Variable", ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace`;

/** From src/styles/tokens.css (light and dark). */
export const SEQUENCE_THEMES: Record<"light" | "dark", SequenceTheme> = {
  light: {
    name: "light",
    background: "#ffffff",
    surface: "#f7f8fa",
    line: "#e2e6ed",
    lineStrong: "#cdd3de",
    text: "#131926",
    text2: "#566074",
    text3: "#656d80",
    band: "#f3f5f8",
    warn: "#b86e00",
    warnSoft: "rgba(229, 160, 13, 0.16)",
    danger: "#d1393f",
    dangerSoft: "rgba(209, 57, 63, 0.11)",
    font: FONT,
    mono: MONO,
  },
  dark: {
    name: "dark",
    background: "#141a26",
    surface: "#1b2232",
    line: "#232b3c",
    lineStrong: "#313b51",
    text: "#e8ecf4",
    text2: "#9ba5b9",
    text3: "#8992a9",
    band: "#181f2d",
    warn: "#f5b84a",
    warnSoft: "rgba(245, 184, 74, 0.15)",
    danger: "#ff6b6f",
    dangerSoft: "rgba(255, 107, 111, 0.14)",
    font: FONT,
    mono: MONO,
  },
};

/** Text width in px. The default estimates from character classes (good enough for layout). */
export type Measure = (text: string, size: number, opts?: { bold?: boolean; mono?: boolean }) => number;

export const estimateWidth: Measure = (text, size, opts = {}) => {
  if (opts.mono) return text.length * size * 0.6;
  let units = 0;
  for (const ch of text) {
    if ("il.,:;'|!".includes(ch)) units += 0.3;
    else if ("mwMW@".includes(ch)) units += 0.85;
    else if (ch >= "A" && ch <= "Z") units += 0.66;
    else if (ch === " ") units += 0.28;
    else units += 0.54;
  }
  return units * size * (opts.bold ? 1.06 : 1);
};

export interface SvgLayout {
  svg: string;
  width: number;
  height: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const n = (v: number) => String(Math.round(v * 10) / 10);

const PAD = 28;
const GUTTER = 70;
const HEAD_H = 64;
const BOX_H = 38;
const MAX_BOX = 190;
const ROW = { arrow: 44, detail: 54, self: 58, note: 34, gap: 38 } as const;

function truncate(text: string, max: number, size: number, measure: Measure, bold = false): string {
  if (measure(text, size, { bold }) <= max) return text;
  let out = text;
  while (out.length > 1 && measure(`${out}…`, size, { bold }) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function stroke(style: ArrowStyle, theme: SequenceTheme): { color: string; dash?: string } {
  switch (style) {
    case "reply":
      return { color: theme.text3, dash: "5 4" };
    case "retry":
      return { color: theme.warn, dash: "5 4" };
    case "dlq":
      return { color: theme.danger };
    default:
      return { color: theme.text2 };
  }
}

export function toSvg(model: SequenceModel, theme: SequenceTheme, measure: Measure = estimateWidth): SvgLayout {
  const parts = model.participants;
  const index = new Map(parts.map((p, i) => [p.id, i]));
  const labels = parts.map((p) => truncate(p.label, MAX_BOX - 28, 12.5, measure, true));
  const boxW = labels.map((l) => Math.max(96, Math.min(MAX_BOX, measure(l, 12.5, { bold: true }) + 28)));

  // Distance between neighbouring lifelines: room for both boxes, then for every arrow label.
  const gaps = parts.slice(1).map((_, i) => Math.max(120, (boxW[i] + boxW[i + 1]) / 2 + 24));
  const arrows = model.items.filter((x): x is SequenceArrow => x.kind === "arrow" && x.from !== x.to);
  const spans = arrows
    .map((a) => {
      const i = index.get(a.from)!,
        j = index.get(a.to)!;
      const label = Math.max(measure(a.label, 12, { bold: true }) + 22, a.detail ? measure(a.detail, 10.5) + 12 : 0);
      return { lo: Math.min(i, j), hi: Math.max(i, j), need: label + 36 };
    })
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
  for (const s of spans) {
    let have = 0;
    for (let k = s.lo; k < s.hi; k++) have += gaps[k];
    if (have < s.need) for (let k = s.lo; k < s.hi; k++) gaps[k] += (s.need - have) / (s.hi - s.lo);
  }
  // Notes are centred on their lifeline; keep the outermost ones inside the picture.
  const noteW = (text: string) => measure(text, 11.5, { bold: true }) + 26;
  let leftNeed = boxW[0] / 2,
    rightNeed = boxW.at(-1)! / 2;
  for (const item of model.items) {
    if (item.kind !== "note") continue;
    const i = index.get(item.over);
    if (i === 0) leftNeed = Math.max(leftNeed, noteW(item.text) / 2);
    if (i === parts.length - 1) rightNeed = Math.max(rightNeed, noteW(item.text) / 2);
    if (item.kind === "note" && parts.length === 1) rightNeed = Math.max(rightNeed, noteW(item.text) / 2);
  }
  const selfLoop = model.items.some((x) => x.kind === "arrow" && x.from === x.to);
  const xs: number[] = [PAD + GUTTER + leftNeed];
  for (const g of gaps) xs.push(xs.at(-1)! + g);
  const titleW = Math.max(measure(model.title, 15, { bold: true }), measure(model.summary, 12)) + PAD * 2;
  const width = Math.ceil(Math.max(xs.at(-1)! + rightNeed + (selfLoop ? 60 : 0) + PAD, titleW, 420));

  // A gap's words sit over the lifeline where the time went, kept inside the band.
  const gapX = (node: string | undefined, w: number) => {
    const at = node !== undefined && index.has(node) ? xs[index.get(node)!] : (xs[0] + xs.at(-1)!) / 2;
    return Math.max(PAD + GUTTER + w / 2, Math.min(width - PAD - 12 - w / 2, at));
  };

  // Rows.
  const boxTop = PAD + HEAD_H;
  let y = boxTop + BOX_H + 22;
  const body: string[] = [];
  const t = theme;
  model.items.forEach((item, i) => {
    if (item.kind === "gap") {
      const h = ROW.gap;
      const heavy = item.ms >= model.totalMs * 0.25;
      const ink = heavy ? t.warn : t.text2;
      body.push(
        `<g data-testid="seq-gap-${i}" data-ms="${Math.round(item.ms)}">`,
        `<rect x="${PAD}" y="${n(y)}" width="${n(width - PAD * 2)}" height="${h - 8}" rx="6" fill="${heavy ? t.warnSoft : t.band}"/>`,
        `<text x="${n(PAD + 12)}" y="${n(y + h / 2)}" font-family="${esc(t.mono)}" font-size="10.5" fill="${ink}" dominant-baseline="middle">${esc(formatOffset(item.t))}</text>`,
        `<text x="${n(gapX(item.node, measure(`⏱ ${item.text}`, 11.5, { bold: true })))}" y="${n(y + (h - 8) / 2 + 0.5)}" font-family="${esc(t.font)}" font-size="11.5" font-weight="600" fill="${ink}" text-anchor="middle" dominant-baseline="middle"><tspan>⏱ </tspan>${esc(item.text)}</text>`,
        `</g>`,
      );
      y += h;
      return;
    }
    if (item.kind === "note") {
      const h = ROW.note;
      const x = xs[index.get(item.over) ?? 0];
      const w = noteW(item.text);
      const ink = item.tone === "danger" ? t.danger : t.warn;
      const fill = item.tone === "danger" ? t.dangerSoft : t.warnSoft;
      body.push(
        `<g data-testid="seq-note-${i}" data-tone="${item.tone}" data-node="${esc(item.over)}">`,
        `<text x="${n(PAD + GUTTER - 14)}" y="${n(y + h / 2 - 3)}" font-family="${esc(t.mono)}" font-size="10.5" fill="${t.text3}" text-anchor="end" dominant-baseline="middle">${esc(formatOffset(item.t))}</text>`,
        `<rect x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${h - 8}" rx="6" fill="${t.background}"/>`,
        `<rect x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${h - 8}" rx="6" fill="${fill}" stroke="${ink}" stroke-opacity="0.45"/>`,
        `<text x="${n(x)}" y="${n(y + (h - 8) / 2 + 0.5)}" font-family="${esc(t.font)}" font-size="11.5" font-weight="600" fill="${ink}" text-anchor="middle" dominant-baseline="middle">${esc(item.text)}</text>`,
        `</g>`,
      );
      y += h;
      return;
    }
    const a = item;
    const self = a.from === a.to;
    const h = self ? ROW.self : a.detail ? ROW.detail : ROW.arrow;
    const x1 = xs[index.get(a.from) ?? 0],
      x2 = xs[index.get(a.to) ?? 0];
    const dir = x2 >= x1 ? 1 : -1;
    const ly = y + 22;
    const { color, dash } = stroke(a.style, t);
    const filled = a.style === "sync" || a.style === "dlq";
    const tip = self ? x1 + 3 : x2 - dir * 3;
    const head = (tx: number, ty: number, d: number) =>
      filled
        ? `<path d="M${n(tx)} ${n(ty)} l${n(-d * 9)} -4.5 v9 z" fill="${color}"/>`
        : `<path d="M${n(tx - d * 9)} ${n(ty - 4.5)} L${n(tx)} ${n(ty)} L${n(tx - d * 9)} ${n(ty + 4.5)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    const line = self
      ? `<path d="M${n(x1 + 3)} ${n(ly)} h34 v16 H${n(x1 + 12)}" fill="none" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
        head(x1 + 3, ly + 16, -1)
      : `<line x1="${n(x1 + dir * 3)}" y1="${n(ly)}" x2="${n(tip - dir * 1)}" y2="${n(ly)}" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
        head(tip, ly, dir);
    const mid = self ? x1 + 46 : (x1 + x2) / 2;
    const anchor = self ? "start" : "middle";
    const quiet = a.style === "reply";
    const labelW = measure(a.label, quiet ? 11 : 12, { bold: !quiet });
    const dotX = self ? mid : mid - labelW / 2 - 9;
    const textX = self ? mid + 10 : mid + (quiet ? 0 : 5);
    // Labels sit on a patch of background so lifelines don't run through the words.
    const labelLeft = self ? mid - 6 : quiet ? textX - labelW / 2 - 4 : dotX - 7;
    const labelRight = self ? textX + labelW + 4 : textX + labelW / 2 + 4;
    const detailW = a.detail ? measure(a.detail, 10.5) : 0;
    const patch =
      `<rect x="${n(labelLeft)}" y="${n(ly - 19)}" width="${n(labelRight - labelLeft)}" height="16" rx="3" fill="${t.background}"/>` +
      (a.detail
        ? `<rect x="${n(self ? mid - 4 : mid - detailW / 2 - 4)}" y="${n(ly + 6)}" width="${n(detailW + 8)}" height="14" rx="3" fill="${t.background}"/>`
        : "");
    body.push(
      `<g data-testid="seq-arrow-${i}" data-style="${a.style}" data-from="${esc(a.from)}" data-to="${esc(a.to)}">`,
      `<text x="${n(PAD + GUTTER - 14)}" y="${n(ly)}" font-family="${esc(t.mono)}" font-size="10.5" fill="${t.text3}" text-anchor="end" dominant-baseline="middle">${esc(formatOffset(a.t))}</text>`,
      line,
      patch,
      quiet
        ? ""
        : `<circle cx="${n(dotX)}" cy="${n(ly - 11)}" r="3.5" fill="${a.style === "dlq" ? t.danger : a.style === "retry" ? t.warn : messageColor(a.type)}"/>`,
      `<text x="${n(textX)}" y="${n(ly - 10.5)}" font-family="${esc(t.font)}" font-size="${quiet ? 11 : 12}" font-weight="${quiet ? 500 : 600}" fill="${quiet ? t.text3 : a.style === "dlq" ? t.danger : a.style === "retry" ? t.warn : t.text}" text-anchor="${anchor}" dominant-baseline="middle">${esc(a.label)}</text>`,
      a.detail
        ? `<text x="${n(self ? mid : mid)}" y="${n(ly + 13)}" font-family="${esc(t.font)}" font-size="10.5" fill="${t.text3}" text-anchor="${anchor}" dominant-baseline="middle">${esc(a.detail)}</text>`
        : "",
      `</g>`,
    );
    y += h;
  });
  const bottom = y + 6;
  const height = Math.ceil(bottom + PAD);

  const head = [
    `<text x="${PAD}" y="${PAD + 14}" font-family="${esc(t.font)}" font-size="15" font-weight="650" fill="${t.text}">${esc(model.title)}</text>`,
    `<text x="${PAD}" y="${PAD + 36}" font-family="${esc(t.font)}" font-size="12" fill="${t.text2}">${esc(model.summary)}${model.partial ? " · joined in flight" : ""}${model.truncated ? " · cut short (very long journey)" : ""}</text>`,
  ];
  const lifelines = xs.map(
    (x, i) =>
      `<line x1="${n(x)}" y1="${boxTop + BOX_H}" x2="${n(x)}" y2="${n(bottom)}" stroke="${t.lineStrong}" stroke-width="1" stroke-dasharray="3 4" data-node="${esc(parts[i].id)}"/>`,
  );
  const boxes = xs.map(
    (x, i) =>
      `<g data-testid="seq-participant-${esc(parts[i].id)}"><rect x="${n(x - boxW[i] / 2)}" y="${boxTop}" width="${n(boxW[i])}" height="${BOX_H}" rx="9" fill="${t.surface}" stroke="${t.lineStrong}"/>` +
      `<text x="${n(x)}" y="${n(boxTop + BOX_H / 2 + 0.5)}" font-family="${esc(t.font)}" font-size="12.5" font-weight="600" fill="${t.text}" text-anchor="middle" dominant-baseline="middle">${esc(labels[i])}</text></g>`,
  );
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Sequence diagram: ${model.title}, ${model.summary}`)}" data-testid="sequence-svg" data-theme="${t.name}">`,
    `<rect width="${width}" height="${height}" fill="${t.background}"/>`,
    ...head,
    ...lifelines,
    ...boxes,
    ...body,
    `</svg>`,
  ].join("");
  return { svg, width, height };
}
