import type { RoomRegistry } from "./collab/rooms";
import type { ServerConfig } from "./config";

/** Labels are from server-owned constants only; never request fields or room identities. */
export type RefusalReason =
  | "origin"
  | "ip-cap"
  | "socket-cap"
  | "buffers"
  | "draining"
  | "protocol"
  | "room-cap"
  | "server-cap"
  | "rate"
  | "size";
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
      "# TYPE rooms_by_size gauge",
      ...Array.from({ length: config.roomCap }, (_, i) => i + 1).map(
        (size) => `rooms_by_size{size="${size}"} ${sizes.filter((n) => n === size).length}`,
      ),
      "",
    ].join("\n");
  }
}
