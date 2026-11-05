import type { Fault } from "../model/faults";
import type { LiveController } from "./controller";

type AnnouncePurge = (
  controller: LiveController,
  fault: Extract<Fault, { kind: "purge" }>,
  announce?: (text: string) => void,
) => void;
let installed: AnnouncePurge | undefined;
export function installPurgeAnnouncement(announce: AnnouncePurge) {
  installed = announce;
}
/** Installed with the cache surface, before its controller can accept a purge. */
export const announcePurge: AnnouncePurge = (...args) => installed?.(...args);
