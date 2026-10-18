import { WebSocket } from "ws";
import { RELAY_CLOSE, RELAY_LIMITS } from "../../../../src/collab/transport/relayProtocol";
import type { ServerConfig } from "../config";

/** Server-owned reservations include WebSocket framing and one maximum-size close per socket. */
export class OutboundBudget {
  private total = 0;
  private sockets = new Map<WebSocket, { bytes: number; closing: boolean }>();
  constructor(private config: Pick<ServerConfig, "socketBufferBytes" | "totalBufferBytes">) {}

  get bufferedBytes(): number {
    return this.total;
  }
  get canTrack(): boolean {
    return this.total + RELAY_LIMITS.closeFrameBytes <= this.config.totalBufferBytes;
  }
  track(socket: WebSocket): void {
    const state = { bytes: RELAY_LIMITS.closeFrameBytes as number, closing: false };
    this.sockets.set(socket, state);
    this.total += RELAY_LIMITS.closeFrameBytes;
    socket.once("close", () => {
      this.total -= state.bytes;
      state.bytes = 0;
      this.sockets.delete(socket);
    });
  }
  close(socket: WebSocket, code: number): void {
    const state = this.sockets.get(socket);
    if (!state || state.closing) return;
    state.closing = true;
    socket.close(code); // Admission reserved even an automatic close reply echoing a peer's reason.
  }
  send(socket: WebSocket, data: string | Uint8Array): void {
    this.enqueue(socket, Buffer.byteLength(data), (done) => socket.send(data, done));
  }
  ping(socket: WebSocket): void {
    this.enqueue(socket, 0, (done) => socket.ping(undefined, false, done));
  }
  pong(socket: WebSocket, data: Buffer): void {
    this.enqueue(socket, data.length, (done) => socket.pong(data, false, done));
  }
  private enqueue(socket: WebSocket, length: number, write: (done: (error?: Error) => void) => void): void {
    const state = this.sockets.get(socket);
    if (!state || state.closing || socket.readyState !== WebSocket.OPEN) return;
    const bytes = length + (length < 126 ? 2 : length <= 65535 ? 4 : 10);
    if (
      Math.max(state.bytes, socket.bufferedAmount + RELAY_LIMITS.closeFrameBytes) + bytes >
        this.config.socketBufferBytes ||
      this.total + bytes > this.config.totalBufferBytes
    ) {
      this.close(socket, RELAY_CLOSE.rate);
      return;
    }
    this.total += bytes;
    state.bytes += bytes;
    let pending = true;
    const done = (error?: Error) => {
      if (!pending) return;
      pending = false;
      if (this.sockets.get(socket) === state) {
        state.bytes -= bytes;
        this.total -= bytes;
      }
      if (error) socket.terminate();
    };
    try {
      write(done);
    } catch {
      done(new Error("Outbound write failed"));
    }
  }
}
