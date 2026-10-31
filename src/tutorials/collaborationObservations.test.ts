import { expect, it, vi } from "vitest";
import { RoomLifecycle } from "../collab/room/lifecycle";
import { memoryTabRoom } from "../collab/room/tabRoom";
import { seededBytes } from "../collab/random";
import type { CollabTransport } from "../collab/transport/types";
import { cancelObservedWork } from "../lib/observations";

const context = vi.hoisted(() => ({ current: { documentId: "first", identity: {} } }));
vi.mock("../palette/observationSource", () => ({ currentObservationSource: () => context.current }));

it("cancelling a superseded join cannot cancel the new document's join", async () => {
  const pending: ((error: Error) => void)[] = [];
  const transport = vi.fn(() => new Promise<CollabTransport>((_, reject) => pending.push(reject)));
  const room = new RoomLifecycle({
    transport,
    tab: memoryTabRoom(),
    random: seededBytes(1),
    signedRooms: false,
    library: {
      create: () => "copy",
      save: () => true,
      read: () => undefined,
      privacy: () => ({}),
      markPrivate: () => {},
      watch: () => () => {},
    },
  });
  const diagram = { format: "diagrams/v1" as const, title: "", nodes: [], edges: [] };
  const firstSource = context.current;
  const first = room.start({ slug: "first", diagram });
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  context.current = { documentId: "second", identity: {} };
  const second = room.start({ slug: "second", diagram });
  try {
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    cancelObservedWork(firstSource);
    expect(room.getSnapshot().opening).toBe("creator");
  } finally {
    pending.forEach((reject) => reject(new Error("End test")));
    await Promise.all([first, second]);
    await room.leave();
  }
});
