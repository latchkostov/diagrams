import { COLLAB_MODE } from "../../lib/deployment";
import type { RoomKeys } from "../keys";
import { PrivateDiagramError } from "../session";

// Each build has exactly one transport. Server builds contact only their relay; public builds use the
// configured trackers and ICE servers. These endpoint literals stay in lazy room chunks, never startup.
// E2E public rooms use only injected local endpoints; relay tests exercise the compiled server mode.

declare const __DEPLOYMENT_COLLAB_SERVER__: string;
declare const __DEPLOYMENT_COLLAB_MODE__: "off" | "public" | "server";

declare const __DEPLOYMENT_COLLAB_TRACKERS__: string[];
declare const __DEPLOYMENT_COLLAB_ICE_SERVERS__: RTCIceServer[];

export interface RoomEndpoints {
  trackers: readonly string[];
  iceServers: RTCIceServer[];
}

declare global {
  interface Window {
    __collabEndpoints?: Partial<RoomEndpoints>;
  }
}

/** Server rooms always have an endpoint. Public rooms with no trackers retain their specific explanation. */
export const relayMode = COLLAB_MODE === "server";
export const hasRoomServices = () => relayMode || roomEndpoints().trackers.length > 0;

/** Resolve against the served base, including a self-hosted subpath. Never contacts a service. */
export function roomRelayUrl(base = document.baseURI): string {
  const url = new URL(__DEPLOYMENT_COLLAB_SERVER__ || "collab/v1", base);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  return url.href;
}

export async function roomTransport(keys: RoomKeys, allowed: () => boolean = () => true) {
  // Keep this literal branch at the import site: the other transport must never enter the module graph.
  if (__DEPLOYMENT_COLLAB_MODE__ === "server") {
    const { createRelayTransport } = await import("../transport/relay");
    if (!allowed()) throw new PrivateDiagramError();
    return createRelayTransport({ url: roomRelayUrl(), roomId: keys.roomId });
  }
  const { createTrackerTransport } = await import("../transport/tracker");
  if (!allowed()) throw new PrivateDiagramError();
  return createTrackerTransport({ ...roomEndpoints(), discovery: keys.discovery, signal: keys.signal, maxPeers: 7 });
}

export const roomServiceHosts = () => (relayMode ? [new URL(roomRelayUrl()).hostname] : serviceHosts(roomEndpoints()));

export function roomEndpoints(): RoomEndpoints {
  if (import.meta.env.VITE_E2E === "1") {
    const test = window.__collabEndpoints;
    return { trackers: test?.trackers ?? [], iceServers: test?.iceServers ?? [] };
  }
  return { trackers: __DEPLOYMENT_COLLAB_TRACKERS__, iceServers: __DEPLOYMENT_COLLAB_ICE_SERVERS__ };
}

/** The hosts a room's endpoints name, once each, in order (what the consent dialogs list). */
export function serviceHosts(endpoints: RoomEndpoints): string[] {
  const host = (url: string) =>
    /^wss?:/.test(url) ? new URL(url).hostname : url.replace(/^(?:stuns?|turns?):/, "").replace(/[:?].*$/, "");
  const urls = [...endpoints.trackers, ...endpoints.iceServers.flatMap((s) => [s.urls].flat())];
  return [...new Set(urls.map(host))];
}
