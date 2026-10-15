import { describe, expect, it, vi } from "vitest";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import { DEFAULT_TOKENS, type OverlayView, type Rect } from "../particleRenderer";
import { SlowPainter } from "./painter";
import type { SlowFrame } from "./script";

// Count both building the frame's indexes and reading their boxes during placement. Wrapping the
// real implementation keeps scans visible too, even if they reuse an index rather than rebuild it.
const obstacleWork = vi.hoisted(() => ({ enabled: false, builds: 0, reads: 0 }));
vi.mock("../traceLabels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../traceLabels")>();
  const counted = (boxes: readonly import("../traceLabels").Box[]) =>
    boxes.map((box) =>
      obstacleWork.enabled
        ? new Proxy(box, {
            get(target, key, receiver) {
              obstacleWork.reads++;
              return Reflect.get(target, key, receiver) as unknown;
            },
          })
        : box,
    );
  return {
    ...actual,
    LabelObstacles: class extends actual.LabelObstacles {
      constructor(...[hard, soft = [], cell]: ConstructorParameters<typeof actual.LabelObstacles>) {
        super(counted(hard), counted(soft), cell);
        if (obstacleWork.enabled) obstacleWork.builds++;
      }
    },
    placeTraceLabels: (...[reqs, env]: Parameters<typeof actual.placeTraceLabels>) => {
      // The fallback constructor inside the real module has a lexical reference to its class.
      // Count it too if a caller stops sharing the frame's indexes.
      if (obstacleWork.enabled && !env.obstacles) {
        obstacleWork.builds++;
        return actual.placeTraceLabels(reqs, { ...env, hard: counted(env.hard ?? []), soft: counted(env.soft ?? []) });
      }
      return actual.placeTraceLabels(reqs, env);
    },
  };
});

const emptyFrame: SlowFrame = {
  t: 500,
  real: 450,
  dots: [],
  rings: [],
  flashes: [],
  queues: [],
  lit: [],
  landings: [],
  captions: [],
  visited: [],
  activeRows: [],
  moving: 0,
  travelling: false,
  frontier: [],
  beat: 2,
  done: false,
};

function paint(theme: "light" | "dark", crowded = false, coveredByLabels = false) {
  const frame: SlowFrame = {
    ...emptyFrame,
    captions: [
      {
        key: "work",
        text: "Worker · processing · 450 ms",
        node: "worker",
        tone: "plain",
        priority: 3,
        color: "#0088cc",
      },
      { key: "retry", text: "↻ ×3", node: "worker", tone: "warn", priority: 5, chip: true, color: "#0088cc" },
    ],
    visited: [
      { node: "source", real: 0 },
      { node: "worker", real: 450 },
    ],
    frontier: ["worker"],
  };
  const nodes: Record<string, Rect> = {
    source: { x: 100, y: 200, width: 160, height: 60 },
    worker: { x: 440, y: 200, width: 160, height: 60 },
  };
  const hard = crowded ? [{ x: 0, y: 0, width: 1000, height: 600 }] : Object.values(nodes);
  const soft = coveredByLabels ? [{ x: 0, y: 0, width: 1000, height: 600 }] : [];
  const { painter, calls } = paintFrame(frame, nodes, hard, soft, { theme });
  return { painter, calls, hard };
}

function paintFrame(
  frame: SlowFrame,
  nodes: Record<string, Rect>,
  hard: Rect[],
  soft: Rect[],
  {
    theme = "light",
    width = 1000,
    height = 600,
    times = 1,
  }: Partial<Pick<OverlayView, "theme" | "width" | "height">> & {
    times?: number;
  } = {},
) {
  const calls: { text: string; alpha: number; color: string | CanvasGradient | CanvasPattern; font: string }[] = [];
  const ctx = new Proxy(
    {
      font: "",
      globalAlpha: 1,
      fillStyle: "",
      measureText(text: string) {
        return { width: text.length * Number.parseFloat(this.font.split(" ")[1]) * 0.55 };
      },
      fillText(text: string) {
        calls.push({ text, alpha: this.globalAlpha, color: this.fillStyle, font: this.font });
      },
    },
    { get: (target, key) => Reflect.get(target, key) ?? vi.fn() },
  ) as unknown as CanvasRenderingContext2D;
  const painter = new SlowPainter();
  painter.show(frame);
  const view = {
    ctx,
    over: ctx,
    dpr: 1,
    k: 1,
    ox: 0,
    oy: 0,
    size: 3,
    width,
    height,
    theme,
    tokens: DEFAULT_TOKENS,
    reduced: false,
    samples: () => null,
    sprite: vi.fn(),
    nodeRect: (id) => nodes[id],
    obstacles: () => ({ hard, soft }),
  } satisfies OverlayView;
  for (let i = 0; i < times; i++) painter.paint(view);
  return { painter, calls, view };
}

describe("slow motion labels", () => {
  it.each(["light", "dark"] as const)(
    "keeps offsets smaller and muted, fades older visits, and avoids overlap in %s",
    (theme) => {
      const { painter, calls, hard } = paint(theme);
      const offsets = painter.labels.filter((l) => l.kind === "offset");
      const caption = painter.labels.find((l) => l.kind === "caption")!;
      expect(offsets.map((l) => l.text)).toEqual(["+0.00 s", "+0.45 s"]);
      expect(offsets[0].opacity).toBeLessThan(offsets[1].opacity);
      for (const offset of offsets) {
        expect(offset.fontSize).toBeLessThan(caption.fontSize);
        const drawn = calls.find((c) => c.text === offset.text)!;
        expect(drawn.alpha).toBe(offset.opacity);
        expect(drawn.color).toBe(theme === "dark" ? "#a9b2c1" : "#566072");
      }
      expect(painter.labels.find((l) => l.kind === "retry")?.text).toBe("↻ ×3");
      for (const [i, a] of painter.labels.entries())
        for (const b of [...painter.labels.slice(i + 1), ...hard.map((r) => ({ ...r, w: r.width, h: r.height }))])
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    },
  );

  it("places the offsets of a long journey with one index of the obstacles per frame, not one per offset", () => {
    // Node cards on a pane that grows with them, a tenth visited. Count cold and subsequent frames:
    // each builds two shared obstacle sets (captions and offsets), regardless of the offset count.
    // An index or a full obstacle scan per offset multiplies cards by offsets: 64x work at 8x size.
    const journey = (n: number) => {
      const nodes: Record<string, Rect> = {};
      for (let i = 0; i < n; i++)
        nodes[`n${i}`] = { x: (i % 40) * 96, y: Math.floor(i / 40) * 48, width: 24, height: 16 };
      const frame: SlowFrame = {
        ...emptyFrame,
        visited: Array.from({ length: n / 10 }, (_, i) => ({ node: `n${i * 10}`, real: i * 10 })),
      };
      const height = Math.ceil(n / 40) * 48 + 200;
      const { painter, view } = paintFrame(frame, nodes, Object.values(nodes), [], {
        width: 40 * 96,
        height,
        times: 0,
      });
      return () => {
        obstacleWork.builds = obstacleWork.reads = 0;
        obstacleWork.enabled = true;
        try {
          painter.paint(view);
          expect(obstacleWork.builds).toBe(2);
          expect(painter.labels.filter((l) => l.kind === "offset")).toHaveLength(n / 10);
          return obstacleWork.reads;
        } finally {
          obstacleWork.enabled = false;
        }
      };
    };
    const small = journey(250);
    const large = journey(250 * GROWTH_FACTOR);
    for (let frame = 0; frame < 2; frame++) {
      const reads = small();
      expect(reads).toBeGreaterThan(0);
      expect(large() / reads).toBeLessThan(LINEAR_LIMIT);
    }
  });

  it("leaves offsets and retry chips out when there is no safe spot", () => {
    expect(paint("light", true).painter.labels).toEqual([]);
  });

  it("never covers existing labels with visited offsets, even when the labels are soft obstacles", () => {
    expect(paint("light", false, true).painter.labels.filter((l) => l.kind === "offset")).toEqual([]);
  });
});
