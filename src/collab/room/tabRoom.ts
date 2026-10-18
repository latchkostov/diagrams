import { bytesToBase64Url } from "../../interop/codec";
import { ROOM_TAB_KEY } from "../../lib/roomEntry";
import { safeSessionStorage } from "../../lib/storage";
import { parseRoomValue, type RoomLink } from "../link";

// This tab's open room (owner decision Q4): a reload keeps you in it. sessionStorage only, so it is never shared
// with another tab or kept past this one; Leave removes it, closing the tab drops it, and Clear everything removes
// it with the app's other session keys. It holds the room value, which is the room key: treat it as one (it never
// goes anywhere but this tab's own storage).

export type RoomRole = "creator" | "joiner";

export interface TabRoomRecord {
  /** `v1.<epoch>.<secret>`: the room link's value. */
  room: string;
  role: RoomRole;
  /** Your diagrams' entry that holds this tab's copy of the room (absent while a joiner waits for the diagram). */
  slug?: string;
  alias?: string;
  /**
   * The copy in Your diagrams was written after the last encrypted checkpoint: it is the newer of the two. A reload
   * then replays the difference into the room (see RoomLifecycle.resume), so an edit made just before it isn't lost.
   */
  ahead?: boolean;
}

export interface TabRoomStore {
  read(): TabRoomRecord | undefined;
  write(record: TabRoomRecord): void;
  clear(): void;
}

export const roomValue = (room: RoomLink) => `v1.${room.epoch}.${bytesToBase64Url(room.secret)}`;

/** The record's room, or undefined when it isn't a valid one (then the record is ignored and dropped). */
export function recordRoom(record: TabRoomRecord): RoomLink | undefined {
  try {
    return parseRoomValue(record.room);
  } catch {
    return undefined;
  }
}

function parseRecord(text: string | null): TabRoomRecord | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Partial<TabRoomRecord>;
    if (typeof v.room !== "string" || (v.role !== "creator" && v.role !== "joiner")) return undefined;
    return {
      room: v.room,
      role: v.role,
      ...(typeof v.slug === "string" ? { slug: v.slug } : {}),
      ...(typeof v.alias === "string" ? { alias: v.alias } : {}),
      ...(v.ahead === true ? { ahead: true } : {}),
    };
  } catch {
    return undefined;
  }
}

export const sessionTabRoom: TabRoomStore = {
  read: () => parseRecord(safeSessionStorage.getItem(ROOM_TAB_KEY)),
  write: (record) => void safeSessionStorage.setItem(ROOM_TAB_KEY, JSON.stringify(record)),
  clear: () => void safeSessionStorage.removeItem(ROOM_TAB_KEY),
};

/** For tests: one tab's sessionStorage, surviving a simulated reload. */
export function memoryTabRoom(): TabRoomStore & { text: string | null } {
  return {
    text: null,
    read() {
      return parseRecord(this.text);
    },
    write(record) {
      this.text = JSON.stringify(record);
    },
    clear() {
      this.text = null;
    },
  };
}
