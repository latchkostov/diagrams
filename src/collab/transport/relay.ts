import { realClock, type Clock } from "../clock";
import { secureRandom, type RandomBytes } from "../random";
import { COLLAB_LIMITS } from "../limits";
import { reconnectDelay } from "./backoff";
import {
  FrameTooLargeError,
  type CollabTransport,
  type TransportHandlers,
  type Connectivity,
  type RelayAdmission,
} from "./types";
import {
  clientFrame,
  isRoomId,
  parseControl,
  readServerFrame,
  RELAY_CLOSE,
  RELAY_LIMITS,
  RELAY_SUBPROTOCOL,
} from "./relayProtocol";

export interface RelayOptions {
  url: string;
  roomId: string;
  /** A knock-to-join room's root (its host key): the relay admits only its members (shared Live P6). */
  root?: string;
  WebSocket?: new (url: string, protocols: string | string[]) => WebSocket;
  clock?: Clock;
  random?: RandomBytes;
}

/** Carries opaque envelopes only; the relay never receives room keys. */
export function createRelayTransport(opts: RelayOptions): CollabTransport {
  if (!isRoomId(opts.roomId)) throw new Error("Invalid relay room ID");
  const url = new URL(opts.url);
  if (!["ws:", "wss:"].includes(url.protocol) || url.search || url.hash || url.username || url.password)
    throw new Error("Invalid relay URL");
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  const clock = opts.clock ?? realClock;
  const random = opts.random ?? secureRandom;
  let socket: WebSocket | undefined;
  let self = "";
  let ready = false;
  let closed = false;
  let failures = 0;
  let maxFrame = RELAY_LIMITS.maxFrameBytes as number;
  let cap = RELAY_LIMITS.roomCap as number;
  let cancelReconnect: (() => void) | undefined;
  let cancelHello: (() => void) | undefined;
  let state: Connectivity = "waiting";
  let handlers: TransportHandlers | undefined;
  const peers = new Set<string>();
  const queues = new Map<string, Promise<void>>();
  // A knock-to-join room: the relay's challenge to this socket, how this page is admitted, and whether it is.
  let challenge: string | undefined;
  let admission: RelayAdmission | undefined;
  let admitted = false;
  let pushQueued = false;
  let cancelRepush: (() => void) | undefined;
  const pushChain = (pieces: readonly { starts: unknown[]; logs: unknown[] }[]) => {
    for (const chain of pieces)
      if (chain.starts.length || chain.logs.length) socket?.send(JSON.stringify({ t: "chain", chain }));
  };
  /** Says which member this page is, then hands the relay the room's chain. */
  async function admit(ws: WebSocket) {
    const a = admission;
    const asked = challenge;
    if (!a || !asked || socket !== ws || !ready) return;
    let proof: { key: string; sig: string };
    try {
      proof = await a.prove(asked, self);
    } catch {
      return;
    }
    if (socket !== ws || challenge !== asked) return;
    ws.send(JSON.stringify({ t: "prove", ...proof }));
    pushChain(a.chain());
  }
  /** Not admitted while this page is in the room: the relay lacks some of the chain (a budget, a restart): again. */
  function repush(ws: WebSocket) {
    cancelRepush?.();
    cancelRepush = clock.after(COLLAB_LIMITS.antiEntropyMs, () => {
      cancelRepush = undefined;
      if (socket !== ws || admitted || !admission?.member()) return;
      pushChain(admission.chain());
      repush(ws);
    });
  }
  let queuedBytes = 0;
  const peerBytes = new Map<string, number>();
  const changed = (next: Connectivity) => {
    state = next;
    handlers?.connectivity?.();
  };
  function clearPeers() {
    ready = false;
    const old = [...peers];
    peers.clear();
    queues.clear();
    peerBytes.clear();
    queuedBytes = 0;
    for (const peer of old) handlers?.leave(peer);
  }
  function retire() {
    cancelStable?.();
    cancelStable = undefined;
    cancelRepush?.();
    cancelRepush = undefined;
    challenge = undefined;
    admitted = false;
    cancelHello?.();
    cancelHello = undefined;
    const old = socket;
    socket = undefined;
    if (old) {
      old.onopen = old.onmessage = old.onclose = null;
      old.onerror = () => {}; // Cancelling a CONNECTING socket may still emit an error (including injected ws).
      old.close();
    }
    clearPeers();
  }
  function reconnect() {
    if (closed || cancelReconnect) return;
    const delay = reconnectDelay(failures++, random);
    cancelReconnect = clock.after(delay, () => {
      cancelReconnect = undefined;
      connect();
    });
  }
  function connect() {
    if (closed) return;
    try {
      const ws = new WS(opts.url, RELAY_SUBPROTOCOL);
      socket = ws;
      ws.binaryType = "arraybuffer";
      const disconnect = (code?: number) => {
        if (socket !== ws) return;
        retire();
        changed(
          code === RELAY_CLOSE.full
            ? "room-full"
            : code === RELAY_CLOSE.serverFull
              ? "server-full"
              : "server-unreachable",
        );
        if (
          code !== RELAY_CLOSE.full &&
          code !== RELAY_CLOSE.serverFull &&
          code !== RELAY_CLOSE.origin &&
          code !== RELAY_CLOSE.badFrame &&
          code !== RELAY_CLOSE.tooBig
        )
          reconnect();
      };
      cancelHello = clock.after(RELAY_LIMITS.helloTimeoutMs, () => disconnect());
      ws.onopen = () => {
        if (socket === ws)
          ws.send(JSON.stringify({ t: "hello", v: 1, room: opts.roomId, ...(opts.root ? { root: opts.root } : {}) }));
      };
      ws.onclose = (e) => disconnect(e.code);
      ws.onerror = () => {}; // The close event schedules a single retry.
      ws.onmessage = (e) => {
        if (socket !== ws || closed) return;
        if (typeof e.data === "string") {
          const message = e.data.length <= 4096 ? parseControl(e.data) : undefined;
          if (!message || (!ready && message.t !== "welcome") || (ready && message.t === "welcome")) {
            disconnect(RELAY_CLOSE.badFrame);
            return;
          }
          if (message.t === "welcome") {
            cancelHello?.();
            cancelHello = undefined;
            self = message.self;
            maxFrame = message.maxFrame;
            cap = message.cap;
            ready = true;
            // Reset only after a stable connection: a relay repeatedly welcoming then closing must back off.
            clockReset(ws);
            for (const peer of message.peers) peers.add(peer);
            changed("connected");
            for (const peer of peers) handlers?.join(peer);
            challenge = message.challenge;
            void admit(ws);
          } else if (message.t === "status") {
            admitted = message.member;
            if (admitted) {
              cancelRepush?.();
              cancelRepush = undefined;
            } else if (admission?.member()) repush(ws);
          } else if (message.t === "join") {
            if (message.peer !== self && !peers.has(message.peer) && peers.size < cap - 1) {
              peers.add(message.peer);
              handlers?.join(message.peer);
            }
          } else if (peers.delete(message.peer)) handlers?.leave(message.peer);
          return;
        }
        const frame = e.data instanceof ArrayBuffer ? readServerFrame(new Uint8Array(e.data)) : undefined;
        if (!ready || !frame || !peers.has(frame.from) || frame.envelope.length > maxFrame) {
          disconnect(RELAY_CLOSE.badFrame);
          return;
        }
        const { from, envelope } = frame;
        if (
          queuedBytes + envelope.length > COLLAB_LIMITS.maxQueuedBytes ||
          (peerBytes.get(from) ?? 0) + envelope.length > COLLAB_LIMITS.maxQueuedBytesPerPeer
        ) {
          disconnect(RELAY_CLOSE.rate);
          return;
        }
        queuedBytes += envelope.length;
        peerBytes.set(from, (peerBytes.get(from) ?? 0) + envelope.length);
        const subscription = handlers;
        const delivery = (queues.get(from) ?? Promise.resolve())
          .then(async () => {
            if (socket === ws && handlers === subscription && peers.has(from))
              await subscription?.frame(from, envelope);
          })
          .catch(() => {})
          .finally(() => {
            if (socket !== ws) return;
            queuedBytes -= envelope.length;
            const remaining = (peerBytes.get(from) ?? 0) - envelope.length;
            if (remaining) peerBytes.set(from, remaining);
            else peerBytes.delete(from);
            if (queues.get(from) === delivery) queues.delete(from);
          });
        queues.set(from, delivery);
      };
    } catch {
      changed("server-unreachable");
      reconnect();
    }
  }
  let cancelStable: (() => void) | undefined;
  function clockReset(ws: WebSocket) {
    cancelStable?.();
    cancelStable = clock.after(RELAY_LIMITS.pingIntervalMs, () => {
      if (socket === ws && ready) failures = 0;
    });
  }
  connect();
  return {
    capabilities: {
      kind: "wss-relay",
      durable: false,
      get maxFrameBytes() {
        return maxFrame;
      },
    },
    get self() {
      return self;
    },
    peers: () => [...peers],
    connectivity: () => state,
    send(bytes, to) {
      if (closed) return;
      if (bytes.length > maxFrame) throw new FrameTooLargeError(bytes.length, maxFrame);
      if (!ready || !socket || (to !== undefined && !peers.has(to))) return;
      const frame = clientFrame(bytes, to);
      if (socket.bufferedAmount + frame.length > RELAY_LIMITS.socketBufferBytes) {
        retire();
        changed("server-unreachable");
        reconnect();
        return;
      }
      socket.send(frame);
    },
    authorize(next) {
      admission = next;
      next.subscribe(() => {
        // Coalesced: a chain taking many entries at once is pushed once, its newest epochs.
        if (pushQueued || admission !== next) return;
        pushQueued = true;
        queueMicrotask(() => {
          pushQueued = false;
          const recent = next.recent();
          if (socket && ready && challenge && recent) pushChain([recent]);
        });
      });
      if (socket && ready && challenge) void admit(socket);
    },
    subscribe(next) {
      handlers = next;
      for (const peer of peers) next.join(peer);
      return () => {
        if (handlers === next) handlers = undefined;
      };
    },
    retry() {
      if (closed) return;
      cancelReconnect?.();
      cancelReconnect = undefined;
      cancelStable?.();
      retire();
      failures = 0;
      changed("waiting");
      connect();
    },
    close() {
      if (closed) return;
      closed = true;
      cancelReconnect?.();
      cancelStable?.();
      retire();
      handlers = undefined;
    },
  };
}
