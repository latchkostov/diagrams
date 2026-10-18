import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { OutboundBudget } from "../src/collab/outbound";
import { RELAY_CLOSE, RELAY_LIMITS } from "../../../src/collab/transport/relayProtocol";

function fakeSocket() {
  return Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn(),
    ping: vi.fn(),
    pong: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  });
}

describe("outbound reservations", () => {
  it.each(["send", "ping", "pong"] as const)("reserves %s before writing and releases on callback or close", (kind) => {
    const budget = new OutboundBudget({ socketBufferBytes: 1024, totalBufferBytes: 1024 });
    const fake = fakeSocket(),
      ws = fake as unknown as WebSocket;
    budget.track(ws);
    const write = () => {
      if (kind === "send") budget.send(ws, "é");
      else if (kind === "ping") budget.ping(ws);
      else budget.pong(ws, Buffer.from([1]));
    };
    write();
    expect(budget.bufferedBytes).toBe(RELAY_LIMITS.closeFrameBytes + (kind === "send" ? 4 : kind === "ping" ? 2 : 3));
    const complete = fake[kind].mock.calls[0].at(-1) as () => void;
    complete();
    complete();
    expect(budget.bufferedBytes).toBe(RELAY_LIMITS.closeFrameBytes);
    write();
    fake.emit("close");
    (fake[kind].mock.calls[1].at(-1) as () => void)();
    expect(budget.bufferedBytes).toBe(0);
  });
  it("budgets membership and heartbeat controls across connections and reserves eviction closes", () => {
    const budget = new OutboundBudget({ socketBufferBytes: 1024, totalBufferBytes: 1024 });
    const a = fakeSocket(),
      b = fakeSocket();
    const wsA = a as unknown as WebSocket,
      wsB = b as unknown as WebSocket;
    budget.track(wsA);
    budget.track(wsB);
    budget.send(wsA, "x".repeat(766));
    expect(budget.bufferedBytes).toBe(1024);
    expect(budget.canTrack).toBe(false);
    budget.ping(wsB);
    expect(b.ping).not.toHaveBeenCalled();
    expect(b.close).toHaveBeenCalledWith(RELAY_CLOSE.rate);
    expect(budget.bufferedBytes).toBe(1024);
    a.emit("close");
    b.emit("close");
    expect(budget.bufferedBytes).toBe(0);
  });
  it("evicts before exceeding the individual socket cap", () => {
    const budget = new OutboundBudget({ socketBufferBytes: RELAY_LIMITS.closeFrameBytes + 16, totalBufferBytes: 1024 });
    const a = fakeSocket(),
      ws = a as unknown as WebSocket;
    budget.track(ws);
    budget.send(ws, new Uint8Array(32));
    expect(a.send).not.toHaveBeenCalled();
    expect(a.close).toHaveBeenCalledWith(RELAY_CLOSE.rate);
    expect(budget.bufferedBytes).toBe(RELAY_LIMITS.closeFrameBytes);
  });
});
