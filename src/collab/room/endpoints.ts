import { COLLAB_STUN, COLLAB_TRACKERS } from "../transport/tracker";

// The public services a room contacts: the two approved matchmaking trackers and Cloudflare's STUN server, fixed
// in code (CSP can't govern STUN, so this list is the allowlist). Nothing here is editable in the app.
//
// The e2e build contacts none of them: its tests emulate a tracker inside the test runner (Playwright's
// routeWebSocket, on this page's own origin) and connect browsers over host candidates. They say where through
// `window.__collabEndpoints` before the page loads; without it, an e2e page has no tracker at all.

export interface RoomEndpoints {
  trackers: readonly string[];
  iceServers: RTCIceServer[];
}

declare global {
  interface Window {
    __collabEndpoints?: Partial<RoomEndpoints>;
  }
}

export function roomEndpoints(): RoomEndpoints {
  if (import.meta.env.VITE_E2E === "1") {
    const test = window.__collabEndpoints;
    return { trackers: test?.trackers ?? [], iceServers: test?.iceServers ?? [] };
  }
  return { trackers: COLLAB_TRACKERS, iceServers: COLLAB_STUN };
}
