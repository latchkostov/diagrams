import { describe, expect, it } from "vitest";
import { describeTransportConformance } from "./conformance";
import { MemoryNetwork } from "./memory";

describeTransportConformance("memory", (seed) => {
  const net = new MemoryNetwork({ seed });
  return {
    connect: () => net.connect(),
    settle: (idle) => net.settle(idle),
    tap: (fn) => net.tap((r) => fn(r.bytes)),
    maxFrameBytes: net.maxFrameBytes,
    faults: {
      set: (f) => net.setFaults(f),
      partition: (groups) => net.partition(groups),
      heal: () => net.heal(),
    },
  };
});

describe("MemoryNetwork faults", () => {
  const run = async (seed: number) => {
    const net = new MemoryNetwork({ seed, faults: { drop: 0.3, duplicate: 0.3, reorder: true } });
    const [a, b] = [net.connect(), net.connect()];
    const got: number[] = [];
    b.subscribe({ frame: (_f, bytes) => void got.push(bytes[0]), join: () => {}, leave: () => {} });
    for (let i = 0; i < 50; i++) a.send(new Uint8Array([i]));
    await net.settle();
    return { got, stats: { ...net.stats } };
  };

  it("replays a schedule exactly from its seed", async () => {
    expect(await run(5)).toEqual(await run(5));
    expect((await run(5)).got).not.toEqual((await run(6)).got);
  });

  it("drops, duplicates and reorders", async () => {
    const { got, stats } = await run(5);
    expect(stats.dropped).toBeGreaterThan(0);
    expect(stats.duplicated).toBeGreaterThan(0);
    expect(got).not.toEqual([...got].sort((x, y) => x - y));
  });

  it("partitions announce leave, healing announces join, and a partitioned link carries nothing", async () => {
    const net = new MemoryNetwork();
    const [a, b] = [net.connect(), net.connect()];
    const events: string[] = [];
    const got: number[] = [];
    a.subscribe({
      frame: (_f, x) => void got.push(x[0]),
      join: (p) => void events.push(`join:${p}`),
      leave: (p) => void events.push(`leave:${p}`),
    });
    net.partition([[a.self], [b.self]]);
    b.send(new Uint8Array([1]));
    await net.settle();
    net.heal();
    b.send(new Uint8Array([2]));
    await net.settle();
    expect(events).toEqual([`join:${b.self}`, `leave:${b.self}`, `join:${b.self}`]);
    expect(got).toEqual([2]);
  });
});
