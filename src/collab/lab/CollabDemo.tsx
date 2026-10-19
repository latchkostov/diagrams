import { useEffect, useState, useSyncExternalStore } from "react";
import { LabCanvas } from "../../lab/LabCanvas";
import type { DiagramFile } from "../../model/types";
import { RoomClient, openRoomClient } from "../client";
import { FakeClock } from "../clock";
import { newRoom } from "../keys";
import { COLLAB_LIMITS } from "../limits";
import { PRESENCE_COLOURS } from "../presence";
import { MemoryNetwork } from "../transport/memory";
import { applyMoves, demoDiagram, refusalMessage } from "./demo";
import { lazyComponent } from "../../lib/lazyLoad";

declare const __DEPLOYMENT_COLLAB_MODE__: "off" | "public" | "server";
// Even a relay build with Lab/test hooks must exclude the public WebRTC spike.
const SpikePanel =
  __DEPLOYMENT_COLLAB_MODE__ === "server"
    ? () => null
    : lazyComponent(() => import("./SpikePanel").then((module) => module.SpikePanel));

// Collaboration C0 in the Lab (dev and e2e builds only): three people in one page, joined by the in-memory network.
// Nothing here touches the network: every frame is an E2E envelope handed between three sessions in this tab. The
// public-matchmaking spike below is separate and connects only when its button is pressed.

const NAMES = ["a", "b", "c"] as const;
type Name = (typeof NAMES)[number];

/** The Lab's room: three clients, a seeded network and a fake clock, driven by the buttons. */
class LabRoom {
  readonly net = new MemoryNetwork({ seed: 7 });
  readonly clock = new FakeClock();
  readonly room = newRoom();
  clients = new Map<Name, RoomClient>();
  paused = false;
  partitioned = false;
  faults = { drop: 0, duplicate: 0, reorder: false };
  private version = 0;
  private listeners = new Set<() => void>();
  private disposed = false;

  async start(): Promise<void> {
    for (const name of NAMES) await this.join(name, name === "a" ? demoDiagram() : undefined);
    await this.deliver();
  }

  private async join(name: Name, initial?: DiagramFile, doc?: RoomClient["session"]["doc"]): Promise<void> {
    const client = await openRoomClient({
      name,
      transport: this.net.connect(),
      room: this.room,
      clock: this.clock,
      initial,
      doc,
    });
    client.session.onChange(() => this.bump());
    this.clients.set(name, client);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.version;

  bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Hands every frame in flight to its receiver (unless delivery is paused, to make edits concurrent). */
  async deliver(force = false): Promise<void> {
    if (this.disposed || (this.paused && !force)) return this.bump();
    await this.net.settle(
      async () => void (await Promise.all([...this.clients.values()].map((c) => c.session.idle()))),
    );
    this.bump();
  }

  async act(fn: () => unknown): Promise<void> {
    fn();
    await this.deliver();
  }

  setFaults(next: Partial<LabRoom["faults"]>): void {
    this.faults = { ...this.faults, ...next };
    this.net.setFaults(this.faults);
    this.bump();
  }

  async togglePartition(): Promise<void> {
    this.partitioned = !this.partitioned;
    const ids = (n: Name) => this.clients.get(n)!.session.transport.self;
    if (this.partitioned) this.net.partition([[ids("a"), ids("b")], [ids("c")]]);
    else this.net.heal();
    await this.deliver();
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    await this.deliver();
  }

  /** Marks one copy Private, as its owner would: its next step leaves the room instead of sending anything. */
  async makePrivate(name: Name): Promise<void> {
    const client = this.clients.get(name)!;
    client.diagram = { ...client.diagram!, private: true };
    client.binding.localChanged();
    await this.deliver();
  }

  async advance(ms: number): Promise<void> {
    this.clock.advance(ms);
    await this.deliver();
  }

  async rejoin(name: Name): Promise<void> {
    const old = this.clients.get(name)!;
    const doc = old.session.doc;
    const diagram = old.diagram;
    // A copy made Private stays out: it never rejoins.
    if (diagram?.private) return;
    await old.session.leave();
    await this.join(name, undefined, doc);
    this.clients.get(name)!.diagram = diagram;
    await this.deliver();
  }

  converged(): boolean {
    const live = [...this.clients.values()].filter((c) => c.session.status !== "left" && c.ready);
    if (live.length < 2) return true;
    try {
      const first = live[0].projection();
      return live.every((c) => c.projection() === first);
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.clients.values()) void c.session.leave();
  }
}

function useLabRoom(): LabRoom | undefined {
  const [room, setRoom] = useState<LabRoom>();
  useEffect(() => {
    const r = new LabRoom();
    let alive = true;
    void r.start().then(() => alive && setRoom(r));
    return () => {
      alive = false;
      r.dispose();
    };
  }, []);
  return room;
}

export function CollabDemo() {
  const room = useLabRoom();
  return (
    <div className="collab-lab" data-testid="collab-lab">
      <p className="collab-lab-intro">
        Three people in this tab, joined by an in-memory network: every frame between them is an end-to-end encrypted
        envelope, and nothing leaves the page. Pause delivery to make edits concurrent; partition C, edit both sides,
        then heal.
      </p>
      {room ? <Room room={room} /> : <p data-testid="collab-starting">Starting the room…</p>}
      <SpikePanel />
    </div>
  );
}

function Room({ room }: { room: LabRoom }) {
  useSyncExternalStore(room.subscribe, room.snapshot);
  const converged = room.converged();
  return (
    <>
      <div className="collab-lab-controls" role="group" aria-label="Network">
        <span
          className={converged ? "collab-ok" : "collab-warn-status"}
          data-testid="collab-converged"
          data-converged={converged}
        >
          {converged ? "Converged" : "Not converged yet"}
        </span>
        <label>
          <input
            type="checkbox"
            checked={room.paused}
            onChange={(e) => void room.setPaused(e.target.checked)}
            data-testid="collab-pause"
          />{" "}
          Pause delivery
        </label>
        <button className="btn" onClick={() => void room.deliver(true)} data-testid="collab-deliver">
          Deliver ({room.net.pending})
        </button>
        <button className="btn" onClick={() => void room.togglePartition()} data-testid="collab-partition">
          {room.partitioned ? "Heal partition" : "Partition C"}
        </button>
        <button
          className="btn"
          onClick={() => void room.advance(COLLAB_LIMITS.antiEntropyMs)}
          data-testid="collab-advance"
        >
          Advance clock 5 s
        </button>
        <label>
          Drop{" "}
          <select
            value={room.faults.drop}
            onChange={(e) => room.setFaults({ drop: Number(e.target.value) })}
            data-testid="collab-drop"
          >
            {[0, 0.1, 0.3, 0.5].map((v) => (
              <option key={v} value={v}>
                {v * 100}%
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={room.faults.reorder}
            onChange={(e) => room.setFaults({ reorder: e.target.checked, duplicate: e.target.checked ? 0.2 : 0 })}
            data-testid="collab-reorder"
          />{" "}
          Reorder and duplicate
        </label>
        <span className="mono" data-testid="collab-wire">
          {room.net.stats.sent} frames, {(room.net.stats.bytes / 1024).toFixed(1)} KiB ciphertext
        </span>
      </div>
      <div className="collab-lab-clients">
        {NAMES.map((name) => (
          <ClientPanel key={name} room={room} name={name} />
        ))}
      </div>
    </>
  );
}

function ClientPanel({ room, name }: { room: LabRoom; name: Name }) {
  const client = room.clients.get(name)!;
  const s = client.session;
  const d = client.diagram;
  const projection = s.doc.project();
  const rejected = Object.entries(s.stats.rejected);
  const edit = (change: (x: DiagramFile) => DiagramFile, merge?: string) =>
    void room.act(() => client.edit(change, merge));
  const disabled = !client.ready || s.status === "left";
  return (
    <section
      className="collab-client"
      data-testid={`collab-client-${name}`}
      aria-label={`Client ${name.toUpperCase()}`}
    >
      <header>
        <strong>{name.toUpperCase()}</strong> <span data-testid={`collab-${name}-status`}>{s.status}</span>
        {!s.hasDocument && <em> (waiting for a peer)</em>}
        <span className="mono" data-testid={`collab-${name}-nodes`} data-count={d?.nodes.length ?? 0}>
          {" "}
          · {d?.nodes.length ?? 0} nodes
        </span>
      </header>
      <p className="collab-title" data-testid={`collab-${name}-title`}>
        {d?.title ?? "—"}
      </p>
      <ul className="collab-peers" aria-label="People here (names are unverified)" data-testid={`collab-${name}-peers`}>
        {s.peers().map((p) => (
          <li key={p.sender} title="Unverified: a name this person chose">
            <span className="collab-dot" style={{ background: PRESENCE_COLOURS[p.colour] }} aria-hidden="true" />
            {p.alias} ({p.status})
          </li>
        ))}
      </ul>
      <div className="collab-actions">
        <button
          className="btn"
          disabled={disabled}
          data-testid={`collab-${name}-add`}
          onClick={() =>
            edit((x) => ({
              ...x,
              nodes: [
                ...x.nodes,
                {
                  id: client.newId("svc"),
                  stencil: "service.go",
                  label: `${name.toUpperCase()} service`,
                  x: 40 + x.nodes.length * 60,
                  y: 280,
                },
              ],
            }))
          }
        >
          Add node
        </button>
        <button
          className="btn"
          disabled={disabled}
          data-testid={`collab-${name}-rename`}
          onClick={() => edit((x) => ({ ...x, title: `Renamed by ${name.toUpperCase()}` }))}
        >
          Rename
        </button>
        <button
          className="btn"
          disabled={disabled || !d?.nodes.length}
          data-testid={`collab-${name}-delete`}
          onClick={() => {
            const id = d!.nodes.at(-1)!.id;
            edit((x) => ({
              ...x,
              nodes: x.nodes.filter((n) => n.id !== id),
              edges: x.edges.filter((e) => e.from !== id && e.to !== id),
            }));
          }}
        >
          Delete last
        </button>
        <button
          className="btn"
          disabled={disabled}
          data-testid={`collab-${name}-undo`}
          onClick={() => void room.act(() => client.binding.undo())}
        >
          Undo mine
        </button>
        <button
          className="btn"
          disabled={disabled}
          data-testid={`collab-${name}-redo`}
          onClick={() => void room.act(() => client.binding.redo())}
        >
          Redo
        </button>
        <button
          className="btn"
          disabled={disabled}
          data-testid={`collab-${name}-private`}
          title="Marks this copy Private: its next step leaves the room instead of sending anything"
          onClick={() => void room.makePrivate(name)}
        >
          Make Private
        </button>
        <button
          className="btn"
          disabled={!!d?.private}
          data-testid={`collab-${name}-rejoin`}
          onClick={() => void room.rejoin(name)}
        >
          Leave and rejoin
        </button>
      </div>
      {client.binding.refused && (
        <p role="alert" data-testid={`collab-${name}-refused`}>
          {refusalMessage(client.binding.refused)}
        </p>
      )}
      {projection.status === "invalid" && (
        <p role="alert" data-testid={`collab-${name}-invalid`}>
          The room's diagram doesn't validate: {projection.error}
        </p>
      )}
      {projection.hidden.length > 0 && (
        <p data-testid={`collab-${name}-hidden`}>Hidden (incomplete): {projection.hidden.join(", ")}</p>
      )}
      <p className="mono collab-stats" data-testid={`collab-${name}-stats`}>
        sent {s.stats.framesSent} · received {s.stats.framesReceived}
        {rejected.length > 0 && <> · refused {rejected.map(([r, n]) => `${r} ${n}`).join(", ")}</>}
      </p>
      <div className="collab-canvas">
        {d && <LabCanvas diagram={d} minimap={false} onMove={(moves) => edit((cur) => applyMoves(cur, moves))} />}
      </div>
    </section>
  );
}
