import { safeSessionStorage } from "./storage";

// What the app needs to know about rooms (Edit together) before it loads any of their code: whether this page has a
// room to open (a `#room=` link, or a room this tab was in before a reload) and how to ask for one. The rooms
// themselves (src/collab/room) load only then, so local editing never downloads them.

/** This tab's open room (Q4: a reload keeps you in it): sessionStorage, so it ends with the tab or Clear everything. */
export const ROOM_TAB_KEY = "diagrams.collab.room.v1";

/** Ask for a new room from the open diagram (Share's "Edit together…" and Ctrl+K will send it). */
export const EDIT_TOGETHER = "diagrams:edit-together";

const ROOM_PAIR = /(?:^|[#?&])room=/;

/** Whether the address names a room (a cheap look: the room code validates it). */
export const roomInAddress = (loc: Pick<Location, "hash" | "search"> = window.location) =>
  ROOM_PAIR.test(loc.hash) || ROOM_PAIR.test(loc.search);

/** Whether this tab was in a room before a reload. */
export const roomTabPending = () => safeSessionStorage.getItem(ROOM_TAB_KEY) !== null;

/** Whether this page has a room to open: in the address, or this tab's room before a reload. */
export function roomEntryPending(loc: Pick<Location, "hash" | "search"> = window.location): boolean {
  return roomInAddress(loc) || roomTabPending();
}
