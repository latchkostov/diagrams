import type { RoomRegistry } from "./collab/rooms";
import type { ServerConfig } from "./config";

/** Labels are from server-owned constants only; never request fields or room identities. */
export type RefusalReason =
  "origin" | "ip-cap" | "socket-cap" | "buffers" | "draining" | "protocol" | "room-cap" | "rate" | "size";
export class Metrics {
  bytesIn = 0;
  bytesOut = 0;
  private refusals = new Map<RefusalReason, number>();
  refuse(reason: RefusalReason) {
    this.refusals.set(reason, (this.refusals.get(reason) ?? 0) + 1);
  }
  render(rooms: RoomRegistry, sockets: number, buffered: number, config: ServerConfig): string {
    const sizes = [...rooms.sizes()];
    const values = [
      ["rooms_active", "gauge", rooms.size],
      ["sockets_active", "gauge", sockets],
      ["bytes_in_total", "counter", this.bytesIn],
      ["bytes_out_total", "counter", this.bytesOut],
      ["buffer_bytes", "gauge", buffered],
      ["buffer_budget_bytes", "gauge", config.totalBufferBytes],
      ["socket_buffer_budget_bytes", "gauge", config.socketBufferBytes],
    ] as const;
    return [
      ...values.flatMap(([name, type, value]) => [`# TYPE ${name} ${type}`, `${name} ${value}`]),
      "# TYPE refusals_total counter",
      ...[...this.refusals].map(([reason, n]) => `refusals_total{reason="${reason}"} ${n}`),
      "# TYPE room_size histogram",
      ...[...new Set([1, 2, 4, 8, config.roomCap])]
        .sort((a, b) => a - b)
        .map((le) => `room_size_bucket{le="${le}"} ${sizes.filter((n) => n <= le).length}`),
      `room_size_bucket{le="+Inf"} ${sizes.length}`,
      `room_size_sum ${sizes.reduce((sum, n) => sum + n, 0)}`,
      `room_size_count ${sizes.length}`,
      "",
    ].join("\n");
  }
}
