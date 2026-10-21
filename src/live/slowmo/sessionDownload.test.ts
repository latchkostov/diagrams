import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { DiagramFile, Simulation } from "../../model/types";
import { stencilRole } from "../../stencils/roles";
import { LiveController } from "../controller";
import { buildScript, frameAt, stepStop } from "./script";
import { SlowMotion, type SlowSource } from "./session";

// Slow motion's first start waits for its script code (src/live/slowmo/scriptChunk.ts). Here the download is held,
// failed or let through by hand (review 20261021-150030).
const loader = vi.hoisted(() => ({
  code: undefined as unknown,
  pending: [] as { resolve: () => void; reject: () => void }[],
}));
vi.mock("./scriptChunk", () => ({
  slowScript: () => loader.code,
  loadSlowScript: () =>
    new Promise((resolve, reject) =>
      loader.pending.push({
        resolve: () => {
          loader.code = { buildScript, frameAt, stepStop };
          resolve(loader.code);
        },
        reject: () => reject(new Error("download failed")),
      }),
    ),
}));
afterEach(() => {
  loader.code = undefined;
  loader.pending = [];
});

const kafka = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
const stencils = new Map(kafka.nodes.map((n) => [n.id, n.stencil]));
const roleOf = (id: string) => stencilRole(stencils.get(id) ?? "");
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Orders flowing; at 500 ms a pausing note, and behind it Payments goes down. */
const story: Simulation = {
  id: "story",
  title: "Story",
  seed: 7,
  durationMs: 10_000,
  traffic: [{ id: "orders", node: "shopper", shape: { kind: "constant", ratePerSec: 20, durationMs: 10_000 } }],
  timeline: [
    { atMs: 500, action: { do: "note", text: "Watch Payments", pause: true } },
    { atMs: 500, action: { do: "status", node: "payments", status: "down" } },
  ],
};

function setup() {
  const c = new LiveController(kafka, { replayDelayMs: 0 });
  c.selectSimulation(story);
  c.step(1000);
  const unavailable = vi.fn<(source: SlowSource) => void>();
  const slow = new SlowMotion(c, {
    build: (trace, waiting) => buildScript({ trace, diagram: kafka, roleOf, waiting }),
    schedule: (work) => {
      work();
      return () => {};
    },
    unavailable,
  });
  slow.watch();
  return { c, slow, unavailable };
}

it("pending script download freezes live controls", async () => {
  const { c, slow, unavailable } = setup();
  try {
    expect(c.getState().run?.waiting).toBe(true);
    const time = c.snapshot().time;
    slow.start({ kind: "next", node: "shopper" });
    expect(slow.getState()).toMatchObject({ status: "capturing", loading: true });
    expect(c.isHeld).toBe(true);
    // Continue (the note's button and the Enter key both resume), step, seek and play all wait.
    c.resume();
    c.step(1000);
    c.seek(3000);
    c.setPlaying(true);
    expect(c.getState().run?.waiting).toBe(true);
    expect(c.snapshot().time).toBe(time);
    expect(c.snapshot().nodes.payments.status).toBe("up");
    expect(c.isPlaying).toBe(false);

    // Esc meanwhile: live is released where it was, and the late code starts nothing.
    slow.end();
    expect(c.isHeld).toBe(false);
    expect(slow.getState()).toMatchObject({ status: "off", loading: false });
    loader.pending[0].resolve();
    await settle();
    expect(slow.getState().status).toBe("off");
    expect(c.isHeld).toBe(false);
    expect(unavailable).not.toHaveBeenCalled();
  } finally {
    c.dispose();
  }
});

it("a failed script download releases live and hands Retry to the view; the next start records", async () => {
  const { c, slow, unavailable } = setup();
  try {
    const source: SlowSource = { kind: "next", node: "shopper" };
    slow.start(source);
    expect(c.isHeld).toBe(true);
    loader.pending[0].reject();
    await settle();
    expect(slow.getState()).toMatchObject({ status: "off", loading: false });
    expect(c.isHeld).toBe(false);
    expect(c.getState().run?.waiting).toBe(true);
    expect(unavailable).toHaveBeenCalledWith(source);
    // The view's Retry starts again; this download arrives and the journey is recorded from the same moment.
    const time = c.snapshot().time;
    slow.start(source);
    expect(c.isHeld).toBe(true);
    loader.pending[1].resolve();
    await settle();
    expect(slow.getState().status).toBe("on");
    expect(c.snapshot().time).toBe(time);
    slow.end();
    expect(c.isHeld).toBe(false);
  } finally {
    c.dispose();
  }
});
