import { createMachine, defineMachine } from "../lib/machine";
import type { EditorApi } from "../editor/types";
import type { DiagramFile } from "../model/types";
import { openRoomClient, type RoomClient } from "../collab/client";
import { FakeClock } from "../collab/clock";
import { MemoryNetwork } from "../collab/transport/memory";
import { newIdentity } from "../collab/signing";
import { newRoom } from "../collab/keys";
import { LiveController } from "../live/controller";
import { LiveDriver, LiveFollower, type LiveTimers } from "../collab/room/liveShare";
import { sessionChannel } from "../collab/room/watch";
import type { WatchedSession } from "../live/watchBridge";
import { observationPorts } from "../lib/observations";
import { currentObservationSource } from "../palette/observationSource";
import { t } from "../i18n";

export type PeerAction = "join" | "edit" | "watch" | "leave";
type State = { value: "idle" | "busy" | "ready" | "failed"; phase?: PeerAction; copy?: DiagramFile };
type Event = { type: "start" | "fail" | "reset" } | { type: "done"; phase: PeerAction; copy?: DiagramFile };
export const localPeerMachine = defineMachine<State, Event>({
  initial: { value: "idle" },
  states: ["idle", "busy", "ready", "failed"],
  events: [{ type: "start" }, { type: "fail" }, { type: "reset" }, { type: "done", phase: "join" }],
  on: {
    "*": { start: { target: "busy" }, reset: { target: "idle", reduce: () => ({ value: "idle" }) } },
    busy: {
      done: { target: "ready", reduce: (_s, e) => ({ value: "ready", phase: e.phase, copy: e.copy }) },
      fail: { target: "failed" },
    },
  },
});

/** Two encrypted, signed sessions over memory only. No rendezvous, sockets, recovery store or library writes. */
export function createLocalPeerPractice() {
  let machine = createMachine(localPeerMachine);
  const listeners = new Set<() => void>();
  let network = new MemoryNetwork();
  let clock = new FakeClock();
  let host: RoomClient | undefined, peer: RoomClient | undefined;
  let driver: LiveDriver | undefined, follower: LiveFollower | undefined;
  const controllers: LiveController[] = [];
  let lifetime = new AbortController();
  const stops: (() => void)[] = [];
  const send = (e: Event) => {
    machine.send(e);
    listeners.forEach((f) => f());
  };
  const settle = () =>
    network.settle(async () => {
      await host?.session.idle();
      await peer?.session.idle();
    });
  const release = async () => {
    follower?.dispose();
    driver?.dispose();
    follower = undefined;
    driver = undefined;
    controllers.splice(0).forEach((c) => c.dispose());
    stops.splice(0).forEach((stop) => stop());
    const clients = [host, peer];
    host = undefined;
    peer = undefined;
    await Promise.all(
      clients.map(async (c) => {
        if (c) {
          await c.binding.close();
          c.session.doc.destroy();
        }
      }),
    );
  };
  const reset = () => {
    lifetime.abort();
    lifetime = new AbortController();
    void release();
    network = new MemoryNetwork();
    clock = new FakeClock();
    machine = createMachine(localPeerMachine);
    listeners.forEach((f) => f());
  };
  const run = async (action: PeerAction, editor: EditorApi, external?: AbortSignal) => {
    if (machine.state.value === "busy") throw new Error("Practice busy");
    const signal = external ? AbortSignal.any([external, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    if (action !== "join" && !host) {
      await run("join", editor, signal);
      if (action === "watch" || action === "leave") await run("edit", editor, signal);
      if (action === "leave") await run("watch", editor, signal);
    }
    const source = currentObservationSource();
    send({ type: "start" });
    try {
      if (action === "join") {
        await release();
        const [owner, guest] = await Promise.all([newIdentity(), newIdentity()]);
        signal.throwIfAborted();
        const room = newRoom(undefined, owner.key);
        const openedHost = await openRoomClient({
          name: "Host",
          room,
          transport: network.connect(),
          clock,
          initial: {
            ...editor.getDiagram(),
            nodes: editor
              .getDiagram()
              .nodes.map((n) => (n.id === "worker" ? { ...n, label: t("tutorials.workTogether.worker") } : n)),
          },
          signed: { identity: owner },
        });
        if (signal.aborted) {
          await openedHost.binding.close();
          openedHost.session.doc.destroy();
          signal.throwIfAborted();
        }
        host = openedHost;
        if (!(await host.session.appendRoster("policy", { viewOnly: true }))) throw new Error("Role policy refused");
        const openedPeer = await openRoomClient({
          name: "Local peer",
          room: { ...room },
          transport: network.connect(),
          clock,
          signed: { identity: guest },
        });
        if (signal.aborted) {
          await openedPeer.binding.close();
          openedPeer.session.doc.destroy();
          signal.throwIfAborted();
        }
        peer = openedPeer;
        await settle();
        signal.throwIfAborted();
        if (!peer.ready || peer.session.canEdit || host.projection() !== peer.projection())
          throw new Error("Peers did not synchronize");
      } else {
        if (!host || !peer) throw new Error("Start the local peers first");
        if (action === "edit") {
          const change = (d: DiagramFile): DiagramFile => ({
            ...d,
            nodes: d.nodes.map((n) => (n.id === "worker" ? { ...n, label: t("tutorials.workTogether.edited") } : n)),
          });
          if (peer.edit(change) || peer.binding.refused !== "view-only") throw new Error("Viewer edit was not refused");
          if (!(await host.session.appendRoster("admit", { who: peer.session.signed!.key })))
            throw new Error("Editor grant refused");
          await settle();
          signal.throwIfAborted();
          if (!peer.session.canEdit || !peer.edit(change)) throw new Error("Editor edit refused");
          await settle();
          signal.throwIfAborted();
          if (
            host.projection() !== peer.projection() ||
            host.diagram?.nodes.find((n) => n.id === "worker")?.label !== t("tutorials.workTogether.edited")
          )
            throw new Error("Peer edit did not converge");
          editor.updateNode("worker", { label: t("tutorials.workTogether.edited") });
        } else if (action === "watch") {
          const diagram = host.diagram!;
          const a = new LiveController(diagram),
            b = new LiveController(peer.diagram!);
          controllers.push(a, b);
          a.selectSimulation(diagram.simulations![0]);
          a.setPlaying(true);
          const watched = (controller: LiveController): WatchedSession => ({
            controller,
            getDiagram: () => diagram,
            documentId: "local-practice",
            isPrivate: () => false,
            store: { getState: () => ({ transform: [0, 0, 1], width: 1000, height: 600 }), subscribe: () => () => {} },
            camera: { dispatch: () => {}, state: { owner: "fit" }, subscribe: () => () => {} },
          });
          const timers: LiveTimers = {
            now: () => clock.now(),
            every: (ms, f) => clock.every(ms, f),
            soon: (f) => clock.after(0, f),
          };
          driver = new LiveDriver(sessionChannel(host.session), watched(a), () => {}, undefined, timers);
          follower = new LiveFollower(
            sessionChannel(peer.session),
            watched(b),
            host.session.senderId,
            () => {},
            () => {},
            timers,
          );
          await settle();
          for (let tick = 0; tick < 300; tick++) {
            signal.throwIfAborted();
            clock.advance(20);
            a.advance(20);
            b.advance(follower.pace(20));
            await settle();
          }
          a.publish();
          b.publish();
          if (!driver.runId || !follower.holds(driver.runId) || b.getState().snapshot.nodes.worker.processed < 3)
            throw new Error("Follower did not replay the shared run");
        } else {
          const copy = structuredClone(peer.diagram!);
          await release();
          signal.throwIfAborted();
          if (source)
            observationPorts.collaboration.publish({
              ...source,
              status: "left",
              practice: { phase: action, recovery: true },
            });
          send({ type: "done", phase: action, copy });
          return;
        }
      }
      signal.throwIfAborted();
      if (source)
        observationPorts.collaboration.publish({
          ...source,
          status: "joined",
          role: "creator",
          practice: {
            phase: action,
            viewerRefused: action === "edit",
            converged: action === "edit",
            run: driver?.runId,
          },
        });
      send({ type: "done", phase: action });
    } catch (error) {
      if (!signal.aborted) {
        await release();
        send({ type: "fail" });
      }
      throw error;
    }
  };
  return {
    run,
    reset,
    dispose: reset,
    getSnapshot: () => machine.state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
}
