// The services a room contacts: the matchmaking trackers and the ICE servers. Fixed at build time and never editable
// in the app (CSP can't govern STUN or TURN, so this list is the only place that names them). It doesn't limit which
// peer addresses the browser tries: candidates come from the peers, and only network egress rules confine those. livediagrams.dev builds with none of
// the variables set: the two approved trackers and Cloudflare's STUN server, no TURN (scripts/deployment-env.ts,
// APPROVED_TRACKERS and APPROVED_STUN). A self-hosted copy may name its own (VITE_COLLAB_TRACKERS, VITE_COLLAB_STUN,
// VITE_COLLAB_TURN).
//
// The build defines both lists as literals here, not in src/lib/deployment.ts with the other switches: only the
// room's own chunk reads them, so they never ship at startup, and a build without rooms carries none of them.
//
// The e2e build contacts none of them: its tests emulate a tracker inside the test runner (Playwright's
// routeWebSocket) and connect browsers over host candidates. They say where through `window.__collabEndpoints`
// before the page loads; without it, an e2e page has no tracker at all.

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

/**
 * Whether this build names any tracker. Without one a room can never find anyone: an e2e page given no endpoints,
 * or a copy built without any. The room then says so instead of "Could not connect".
 */
export const hasTrackers = () => roomEndpoints().trackers.length > 0;

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
