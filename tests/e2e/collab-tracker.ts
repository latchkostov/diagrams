import type { BrowserContext, WebSocketRoute } from "@playwright/test";

// A WebTorrent tracker for collaboration e2e specs, emulated in the test runner (Playwright's routeWebSocket): no
// server and no public network. It speaks the protocol the transport uses (src/collab/transport/tracker.ts).

export const TRACKER_PATH = "/__test-tracker";

/**
 * One emulated tracker shared by every context given: swarms by info hash, offers and answers forwarded. By default
 * on the app's own origin (TRACKER_PATH); with `trackers`, at those URLs instead (the approved public ones, say),
 * still answered here, so the page's CSP decides whether it may open them and nothing reaches the network.
 */
export async function emulateTracker(contexts: BrowserContext[], { trackers }: { trackers?: readonly string[] } = {}) {
  const swarms = new Map<string, Map<string, WebSocketRoute>>();
  const queued: (() => void)[] = [];
  const sockets = {
    opened: 0,
    held: false,
    /** Holds every offer and answer it would forward, until release(). */
    hold() {
      sockets.held = true;
    },
    release() {
      sockets.held = false;
      for (const send of queued.splice(0)) send();
    },
  };
  const forward = (send: () => void) => (sockets.held ? queued.push(send) : send());
  for (const context of contexts) {
    await context.addInitScript(
      ({ path, urls }) => {
        const own = `${location.origin.replace(/^http/, "ws")}${path}`;
        window.__collabEndpoints = { trackers: urls ?? [own], iceServers: [] };
      },
      { path: TRACKER_PATH, urls: trackers ? [...trackers] : undefined },
    );
    await context.routeWebSocket(
      (url) =>
        trackers
          ? trackers.some((t) => url.href.replace(/\/$/, "") === t.replace(/\/$/, ""))
          : url.pathname === TRACKER_PATH,
      (ws) => {
        sockets.opened++;
        ws.onMessage((raw) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(raw)) as Record<string, unknown>;
          } catch {
            return;
          }
          if (msg.action !== "announce" || typeof msg.info_hash !== "string" || typeof msg.peer_id !== "string") return;
          const hash = msg.info_hash;
          const swarm = swarms.get(hash) ?? new Map<string, WebSocketRoute>();
          swarms.set(hash, swarm);
          if (msg.event === "stopped") {
            swarm.delete(msg.peer_id);
            return;
          }
          swarm.set(msg.peer_id, ws);
          if (msg.answer) {
            const to = swarm.get(String(msg.to_peer_id));
            forward(() =>
              to?.send(
                JSON.stringify({
                  action: "announce",
                  info_hash: hash,
                  peer_id: msg.peer_id,
                  offer_id: msg.offer_id,
                  answer: msg.answer,
                }),
              ),
            );
            return;
          }
          ws.send(JSON.stringify({ action: "announce", info_hash: hash, interval: 120, complete: 0, incomplete: 0 }));
          const offers = (msg.offers as { offer_id: string; offer: unknown }[] | undefined) ?? [];
          const others = [...swarm].filter(([id]) => id !== msg.peer_id);
          others.slice(0, offers.length).forEach(([, peer], i) =>
            forward(() =>
              peer.send(
                JSON.stringify({
                  action: "announce",
                  info_hash: hash,
                  peer_id: msg.peer_id,
                  offer_id: offers[i].offer_id,
                  offer: offers[i].offer,
                }),
              ),
            ),
          );
        });
        ws.onClose(() => {
          for (const swarm of swarms.values()) for (const [id, s] of swarm) if (s === ws) swarm.delete(id);
        });
      },
    );
  }
  return sockets;
}
