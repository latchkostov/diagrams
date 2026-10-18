import type { WebSocket } from "ws";

export interface Room {
  readonly peers: Map<string, WebSocket>;
}
export interface RoomRegistry {
  readonly size: number;
  sizes(): Iterable<number>;
  get(id: string): Room | undefined;
  join(id: string, peer: string, socket: WebSocket): Room | undefined;
  leave(id: string, peer: string): void;
}

export class MemoryRoomRegistry implements RoomRegistry {
  private rooms = new Map<string, Room>();
  constructor(
    private roomCap: number,
    private maxRooms: number,
  ) {}
  get size(): number {
    return this.rooms.size;
  }
  *sizes(): Iterable<number> {
    for (const room of this.rooms.values()) yield room.peers.size;
  }
  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }
  join(id: string, peer: string, socket: WebSocket): Room | undefined {
    let room = this.rooms.get(id);
    if (room ? room.peers.size >= this.roomCap : this.rooms.size >= this.maxRooms) return;
    if (!room) {
      room = { peers: new Map() };
      this.rooms.set(id, room);
    }
    room.peers.set(peer, socket);
    return room;
  }
  leave(id: string, peer: string): void {
    const room = this.rooms.get(id);
    room?.peers.delete(peer);
    if (room?.peers.size === 0) this.rooms.delete(id);
  }
}
