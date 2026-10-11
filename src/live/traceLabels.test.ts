import { describe, expect, it } from "vitest";
import {
  MAX_TRACE_LABELS,
  mergeLabels,
  nearestOnBox,
  placeTraceLabels,
  traceLabelInk,
  type Box,
  type LabelEnv,
  type LabelRequest,
} from "./traceLabels";
import { MESSAGE_PALETTE } from "../sim/colors";

const measure = (text: string) => ({ w: text.length * 7 + 12, h: 18 });
const env = (over: Partial<LabelEnv> = {}): LabelEnv => ({
  measure,
  offset: 8,
  bounds: { x: 0, y: 0, w: 1000, h: 600 },
  hard: [],
  ...over,
});
const req = (id: number, text: string, x: number, y: number, priority = 1): LabelRequest => ({
  id,
  text,
  x,
  y,
  priority,
});
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("trace labels", () => {
  it("bounds placement and measurement work for thousands of distinct fan-out copies, even when suppressed", () => {
    const reqs = Array.from({ length: 1500 }, (_, i) => req(i, `Type${i}`, 500, 300, i === 0 ? 3 : 1));
    let measurements = 0;
    const placed = placeTraceLabels(
      reqs,
      env({
        measure: (text) => {
          measurements++;
          return measure(text);
        },
      }),
    );
    expect(placed.length).toBeLessThanOrEqual(MAX_TRACE_LABELS);
    expect(placed[0].id).toBe(0);
    expect(measurements).toBeLessThanOrEqual(MAX_TRACE_LABELS + 1);
    measurements = 0;
    placeTraceLabels(
      reqs,
      env({
        hard: [{ x: 0, y: 0, w: 1000, h: 600 }],
        measure: (text) => {
          measurements++;
          return measure(text);
        },
      }),
    );
    expect(measurements).toBeLessThanOrEqual(MAX_TRACE_LABELS + 1);
  });

  it("uses local obstacle queries instead of scanning every obstacle for every candidate", () => {
    let reads = 0;
    const hard = Array.from({ length: 10_000 }, (_, i) => ({
      get x() {
        reads++;
        return 2000 + i * 100;
      },
      y: 0,
      w: 20,
      h: 20,
    }));
    placeTraceLabels(
      Array.from({ length: 48 }, (_, i) => req(i, `Type${i}`, 500, 300)),
      env({ hard }),
    );
    expect(reads).toBeLessThan(50_000);
  });

  it("keeps palette, retry and dead-letter label text above 4.5:1 in both themes", () => {
    for (const background of [...MESSAGE_PALETTE, "#d99000", "#d1393f", "#f5b84a", "#ff6b6f"]) {
      const rgb = background
        .slice(1)
        .match(/../g)!
        .map((v) => parseInt(v, 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      const ink = traceLabelInk(background);
      expect(ink === "#000000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("puts a lone label at the first corner, beside its particle", () => {
    const [l] = placeTraceLabels([req(1, "OrderPlaced", 500, 300)], env());
    expect(l).toMatchObject({ x: 508, leader: false, text: "OrderPlaced" });
    expect(l.y + l.h).toBe(292);
  });

  it("merges copies with the same words close together into one label", () => {
    const merged = mergeLabels([req(1, "OrderPlaced", 500, 300), req(2, "OrderPlaced", 510, 310)], 40);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(2);
    const placed = placeTraceLabels([req(1, "OrderPlaced", 500, 300), req(2, "OrderPlaced", 510, 310)], env());
    expect(placed.map((p) => p.text)).toEqual(["OrderPlaced ×2"]);
  });

  it("never lets two labels overlap, even when their particles bunch up", () => {
    const reqs = [
      req(1, "PaymentCompleted", 500, 300),
      req(2, "InventoryReserved", 505, 302),
      req(3, "NotificationRequested", 498, 306),
      req(4, "OrderPlaced", 503, 298),
    ];
    const placed = placeTraceLabels(reqs, env());
    expect(placed).toHaveLength(4);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false);
  });

  it("keeps clear of node cards, stepping out with a leader line when it must", () => {
    // The particle runs down a narrow gap between two cards: every spot right beside it is taken.
    const right: Box = { x: 505, y: 280, w: 200, h: 120 };
    const left: Box = { x: 300, y: 280, w: 195, h: 120 };
    const placed = placeTraceLabels([req(1, "PaymentCompleted", 500, 306)], env({ hard: [right, left] }));
    expect(placed).toHaveLength(1);
    expect(overlaps(placed[0], right)).toBe(false);
    expect(overlaps(placed[0], left)).toBe(false);
    expect(placed[0].leader).toBe(true);
    const end = nearestOnBox(placed[0], 500, 306);
    expect(Math.hypot(end.x - 500, end.y - 306)).toBeGreaterThan(8);
  });

  it("leaves a label out when there's nowhere free (the trace card lists it)", () => {
    const wall: Box = { x: 0, y: 0, w: 1000, h: 600 };
    expect(placeTraceLabels([req(1, "OrderPlaced", 500, 300)], env({ hard: [wall] }))).toEqual([]);
  });

  it("dead letters choose first", () => {
    const placed = placeTraceLabels(
      [req(1, "Invoice", 500, 300, 1), req(2, "Invoice → DLQ", 500, 300, 3)],
      env({ bounds: { x: 0, y: 0, w: 1000, h: 600 } }),
    );
    expect(placed[0].text).toBe("Invoice → DLQ");
  });

  it("prefers a spot clear of edge labels, and keeps last frame's spot while it's free", () => {
    const edgeLabel: Box = { x: 505, y: 270, w: 80, h: 24 };
    const [first] = placeTraceLabels([req(1, "OrderPlaced", 500, 300)], env({ soft: [edgeLabel] }));
    expect(overlaps(first, edgeLabel)).toBe(false);
    // The particle moved a little; the label stays on the same side instead of hopping.
    const previous = new Map([[1, first.spot]]);
    const [next] = placeTraceLabels([req(1, "OrderPlaced", 506, 300)], env({ previous }));
    expect(next.spot).toBe(first.spot);
  });

  it("stays inside the drawable area", () => {
    const [l] = placeTraceLabels([req(1, "OrderPlaced", 995, 5)], env());
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(l.y).toBeGreaterThanOrEqual(0);
    expect(l.x + l.w).toBeLessThanOrEqual(1000);
  });
});
