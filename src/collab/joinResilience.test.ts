import { describe, expect, it, onTestFinished } from "vitest";
import type { DiagramFile } from "../model/types";
import { FakeClock } from "./clock";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import { newIdentity } from "./signing";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { MemoryNetwork, type Faults } from "./transport/memory";
import type { CollabTransport } from "./transport/types";

// A joiner in a signed room (v2) always ends up with the document while the host is reachable, whatever the network
// does to the order and timing of what the host sends: its presence (the binding every other frame is checked
// against) late, lost or after its sync replies; frames lost, duplicated or reordered; a document large enough to
// travel in fragments.

const PRESENCE = 2;

/** A diagram large enough that a whole sync reply travels in fragments (past COLLAB_LIMITS.maxFragmentBytes). */
function largeDiagram(): DiagramFile {
  const base = canaryDiagram();
  const nodes = Array.from({ length: 4_500 }, (_, i) => ({
    id: `bulk${i}`,
    stencil: "postgres",
    label: `${"x".repeat(260)}${i}`,
    x: i,
    y: 0,
  }));
  return { ...base, nodes: [...base.nodes, ...nodes] } as DiagramFile;
}

/** `transport`'s frames go through `filter` first: false drops one. */
function intercept(transport: CollabTransport, filter: (bytes: Uint8Array, to?: string) => boolean): void {
  const send = transport.send.bind(transport);
  transport.send = (bytes, to) => {
    if (filter(bytes, to)) send(bytes, to);
  };
}

async function join(opts: {
  seed: number;
  faults?: Partial<Faults>;
  diagram?: DiagramFile;
  /** What the host's transport does to its frames, once the joiner is there. */
  hostFilter?: (joiner: string) => (bytes: Uint8Array, to?: string) => boolean;
  /** What the joiner's transport does to its frames. */
  joinerFilter?: (bytes: Uint8Array, to?: string) => boolean;
  rounds?: number;
  /** Seen while it waited: the joiner's reasons. */
  waits?: string[];
}): Promise<{ host: TestClient; joiner: TestClient }> {
  const net = new MemoryNetwork({ seed: opts.seed });
  const clock = new FakeClock();
  const hostId = await newIdentity();
  const link: RoomLink = { ...roomFor(opts.seed), hostKey: hostId.key };
  const clients: TestClient[] = [];
  const settle = () => net.settle(async () => void (await Promise.all(clients.map((c) => c.session.idle()))));
  const hostTransport = net.connect();
  const host = await openClient("host", hostTransport, link, clock, opts.seed * 10 + 1, {
    initial: opts.diagram ?? canaryDiagram(),
    signed: { identity: hostId },
  });
  clients.push(host);
  onTestFinished(() => host.session.leave());
  await settle();
  const joinerTransport = net.connect();
  if (opts.hostFilter) intercept(hostTransport, opts.hostFilter(joinerTransport.self));
  if (opts.joinerFilter) intercept(joinerTransport, opts.joinerFilter);
  if (opts.faults) net.setFaults(opts.faults);
  const joiner = await openClient("joiner", joinerTransport, link, clock, opts.seed * 10 + 2, {
    signed: { identity: await newIdentity() },
  });
  clients.push(joiner);
  onTestFinished(() => joiner.session.leave());
  for (let i = 0; i < (opts.rounds ?? 16) && !joiner.session.hasDocument; i++) {
    await settle();
    opts.waits?.push(joiner.session.waiting ?? "none");
    clock.advance(COLLAB_LIMITS.antiEntropyMs);
  }
  await settle();
  return { host, joiner };
}

const why = (c: TestClient) => JSON.stringify(c.session.stats.rejected);

describe("a joiner always gets the document from a reachable host", () => {
  it("baseline", async () => {
    const { joiner } = await join({ seed: 1 });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  });

  it("the host's first presence is lost", async () => {
    let dropped = 0;
    const { joiner } = await join({
      seed: 2,
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && dropped++ < 1),
    });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  });

  it("the host's presence is lost for a long while (its sync replies arrive meanwhile)", async () => {
    let lost = 0;
    const { joiner } = await join({
      seed: 3,
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 5),
      rounds: 30,
    });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  });

  it("a large (fragmented) document while the host's presence is late", async () => {
    let lost = 0;
    const { joiner } = await join({
      seed: 4,
      diagram: largeDiagram(),
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 2),
      rounds: 30,
    });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  }, 120_000);

  it("frames delivered in any order", async () => {
    const { joiner } = await join({ seed: 5, faults: { reorder: true } });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  });

  it("some frames lost and some duplicated", async () => {
    const { joiner } = await join({ seed: 6, faults: { drop: 0.15, duplicate: 0.1 }, rounds: 30 });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  });

  it("a large document, reordered", async () => {
    const { joiner } = await join({ seed: 7, diagram: largeDiagram(), faults: { reorder: true }, rounds: 30 });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  }, 120_000);

  it("the joiner's presence is lost at the host for a long while: the host doesn't hold it against them", async () => {
    let lost = 0;
    const { host, joiner } = await join({
      seed: 8,
      joinerFilter: (bytes) => !(bytes[3] === PRESENCE && lost++ < 6),
      rounds: 30,
    });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
    expect(host.session.stats.rejected.quarantined ?? 0, why(host)).toBe(0);
  });

  it("an honest host held too long (its binding lost, its replies piling up) is never quarantined: dropped, asked again", async () => {
    let lost = 0;
    const { joiner } = await join({
      seed: 9,
      diagram: largeDiagram(),
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 6),
      rounds: 40,
    });
    expect(joiner.session.hasDocument, why(joiner)).toBe(true);
    expect(joiner.session.stats.rejected.quarantined ?? 0).toBe(0);
    expect(joiner.session.stats.rejected["held-dropped"] ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it("says why it waits: checking who's here while the host's binding is missing, then nothing once it has the diagram", async () => {
    let lost = 0;
    const waits: string[] = [];
    const { joiner } = await join({
      seed: 10,
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 3),
      waits,
    });
    expect(waits).toContain("verifying");
    expect(joiner.session.waiting).toBeUndefined();
  });
});
