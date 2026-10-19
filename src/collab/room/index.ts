import {
  createLibraryDiagram,
  DIAGRAMS_CHANGED,
  setDiagramPrivate,
  getCurrent,
  getDiagramIdentity,
  getPrivacyFlags,
  hasLibraryEntry,
  writeAutosave,
} from "../../lib/diagramIO";
import { onClearDevice } from "../../lib/clearDevice";
import { canCollaborate } from "../../lib/localOnly";
import { IndexedDbRecoveryStore } from "../recoveryStore";
import { createTrackerTransport } from "../transport/tracker";
import { roomEndpoints } from "./endpoints";
import { RoomLifecycle } from "./lifecycle";
import { memberId } from "./roomRoster";
import { sessionTabRoom } from "./tabRoom";
import { watchNotices } from "./watchNotices";
import { bindWatch } from "./watch";

// Rooms in the app (Edit together): the one lifecycle this page has, wired to the real things. App.tsx loads this
// module only when the page has a room to open or the person asks for one (src/lib/roomEntry.ts), so local
// editing never downloads it, Yjs included. App configures it (how to show a diagram, how to read the canvas), then
// resumes this tab's room and reads the address.

/** Participants per room, you included (owner decision Q10): a full mesh. */
export const ROOM_CAP = 8;

let store: IndexedDbRecoveryStore | undefined;

/**
 * Tabs of this browser asking each other who holds a member id (a duplicated tab copies its record with it): the tab
 * whose open room has it says so, and the asker takes an id of its own.
 */
const members = typeof BroadcastChannel === "function" ? new BroadcastChannel("diagrams-room-members") : undefined;
members?.addEventListener("message", (e: MessageEvent<{ t?: string; member?: string }>) => {
  const roster = room.getSnapshot().open?.roster.get();
  const member = roster && memberId(roster);
  if (e.data?.t === "who" && member && e.data.member === member) members.postMessage({ t: "mine", member });
});
const memberTaken = (member: string) =>
  new Promise<boolean>((resolve) => {
    if (!members) return resolve(false);
    const done = (taken: boolean) => {
      clearTimeout(timer);
      members.removeEventListener("message", heard);
      resolve(taken);
    };
    const heard = (e: MessageEvent<{ t?: string; member?: string }>) => {
      if (e.data?.t === "mine" && e.data.member === member) done(true);
    };
    const timer = setTimeout(() => done(false), 250);
    members.addEventListener("message", heard);
    members.postMessage({ t: "who", member });
  });

export const room = new RoomLifecycle({
  memberTaken,
  transport: (keys) => {
    const { trackers, iceServers } = roomEndpoints();
    return createTrackerTransport({
      trackers,
      iceServers,
      discovery: keys.discovery,
      signal: keys.signal,
      maxPeers: ROOM_CAP - 1,
    });
  },
  recovery: () => {
    if (typeof indexedDB === "undefined") return undefined;
    return (store ??= new IndexedDbRecoveryStore());
  },
  tab: sessionTabRoom,
  library: {
    // The room's diagram can't be Private (it would leave the room), whatever "New diagrams are private" says.
    create: (diagram) => createLibraryDiagram(diagram, undefined, undefined, { private: false }),
    save: (slug, diagram, quiet) =>
      hasLibraryEntry(slug) && writeAutosave(slug, diagram, getDiagramIdentity(slug), { quiet }),
    read: (slug) => (hasLibraryEntry(slug) ? getCurrent(slug) : undefined),
    privacy: (slug) => getPrivacyFlags(slug),
    // Not recorded (no entry to mark) is a failure too: nothing is then written as an ordinary copy.
    markPrivate: (slug) => {
      if (!setDiagramPrivate(slug, true)) throw new Error("private-not-recorded");
    },
    // Your diagrams' changes here, and another tab's (diagramIO turns its storage events into this one too).
    watch: (fn) => {
      window.addEventListener(DIAGRAMS_CHANGED, fn);
      return () => window.removeEventListener(DIAGRAMS_CHANGED, fn);
    },
  },
});

// The page's moments, as the canvas's autosave has them: the copy is written before the page can go; a page kept
// in the back/forward cache leaves the room for the time being and rejoins when it's shown again.
window.addEventListener("pagehide", (event) => (event.persisted ? room.suspend() : room.pageHidden()));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void room.restore();
});
document.addEventListener("visibilitychange", () => {
  const hidden = document.visibilityState === "hidden";
  if (hidden) room.flush();
  // Away while this tab is hidden: the others stop seeing its pointer.
  room.setAway(hidden);
});
onClearDevice(() => room.wipe());

// Watch together lasts as long as the room's session, whatever's on screen (presenting hides the chip).
bindWatch(
  room,
  {
    read: () => {
      const slug = room.getSnapshot().open?.slug;
      if (!slug) return { eligible: false };
      const diagram = getCurrent(slug);
      return {
        documentId: getDiagramIdentity(slug),
        eligible: canCollaborate({ ...getPrivacyFlags(slug), diagram }) && !diagram?.private,
      };
    },
    show: () => room.showRoomDiagram(),
    subscribe: (fn) => {
      const stop = room.subscribe(fn);
      window.addEventListener(DIAGRAMS_CHANGED, fn);
      return () => {
        stop();
        window.removeEventListener(DIAGRAMS_CHANGED, fn);
      };
    },
  },
  watchNotices,
);

export { RoomChip, RoomConnecting, RoomLayer } from "./RoomUi";
export type { RoomSnapshot, OpenRoom } from "./lifecycle";
