import process from "node:process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { readConfig } from "../src/config";
import { createRelayServer } from "../src/http";
import { MemoryBudgetError, validateMemoryBudget } from "../src/memory";
import { COMPRESSION_LIMITS } from "../src/compression";
import { OutboundBudget } from "../src/collab/outbound";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { RELAY_CLOSE } from "../../../src/collab/transport/relayProtocol";

const MiB = 1024 * 1024;
const values = parse(readFileSync(new URL("../../../deploy/self-host/helm/values.yaml", import.meta.url), "utf8"));
const compose = parse(readFileSync(new URL("../../../deploy/self-host/server/compose.yaml", import.meta.url), "utf8"))
  .services.diagrams;
const defaults = (raw: string) => {
  const match = raw.match(/:-([^}]+)}/);
  if (!match) throw new Error(`Missing Compose default: ${raw}`);
  return match[1];
};

afterEach(() => vi.restoreAllMocks());

describe("container memory budget", () => {
  it.each([128, 512, 1024])(
    "rejects over one quarter of a detected %i MiB limit before starting the server",
    (memory) => {
      vi.spyOn(process, "constrainedMemory").mockReturnValue(memory * MiB);
      const config = readConfig({ LD_TOTAL_BUFFER_BYTES: String((memory * MiB) / 4) });
      expect(() => validateMemoryBudget(config)).not.toThrow();
      config.totalBufferBytes++;
      expect(() => createRelayServer({ config })).toThrow(MemoryBudgetError);
      expect(() => validateMemoryBudget(config)).toThrow(/LD_TOTAL_BUFFER_BYTES exceeds 25%/);
    },
  );

  it("allows an unknown or unconstrained limit", () => {
    vi.spyOn(process, "constrainedMemory").mockReturnValue(0);
    expect(() => validateMemoryBudget(readConfig())).not.toThrow();
  });

  it.each(["Helm", "Compose"])(
    "%s defaults evict slow recipients within the container budget, leaving explicit headroom",
    (kind) => {
      const env: Record<string, string> =
        kind === "Helm"
          ? values.server.env
          : Object.fromEntries(
              ["LD_SOCKET_BUFFER_BYTES", "LD_TOTAL_BUFFER_BYTES", "LD_MAX_SOCKETS"].map((key) => [
                key,
                defaults(compose.environment[key]),
              ]),
            );
      const memory =
        kind === "Helm"
          ? Number(values.server.resources.limits.memory.replace("Mi", "")) * MiB
          : Number(defaults(compose.mem_limit).replace("m", "")) * MiB;
      vi.spyOn(process, "constrainedMemory").mockReturnValue(memory);
      const config = readConfig(env);
      validateMemoryBudget(config);
      const baseline = 128 * MiB;
      const inbound = 2 * config.maxSockets * config.maxPayload;
      const compression =
        COMPRESSION_LIMITS.cacheBytes + COMPRESSION_LIMITS.concurrency * COMPRESSION_LIMITS.fileBytes * 4;
      const reserved = baseline + inbound + compression;
      expect(reserved + config.totalBufferBytes).toBeLessThan(memory);
      expect(config.totalBufferBytes).toBeLessThanOrEqual(memory / 4);
      const refusal = vi.fn();
      const budget = new OutboundBudget(config, undefined, refusal);
      // Send callbacks never complete: every recipient stays slow; retained accounting includes
      // framing and closes. No allocation of the full container's worth of payloads is needed.
      const sockets = Array.from({ length: config.maxSockets }, () =>
        Object.assign(new EventEmitter(), {
          readyState: WebSocket.OPEN,
          bufferedAmount: 0,
          send: vi.fn(),
          close: vi.fn(),
        }),
      );
      for (const socket of sockets) budget.track(socket as unknown as WebSocket);
      const frame = new Uint8Array(config.maxPayload);
      for (let round = 0; round <= Math.ceil(config.socketBufferBytes / frame.length); round++) {
        for (const socket of sockets) budget.send(socket as unknown as WebSocket, frame);
        expect(budget.bufferedBytes).toBeLessThanOrEqual(config.totalBufferBytes);
        expect(reserved + budget.bufferedBytes).toBeLessThan(memory);
      }
      expect(refusal).toHaveBeenCalled();
      for (const socket of sockets) expect(socket.close).toHaveBeenCalledWith(RELAY_CLOSE.rate);
      // Repeated permitted sends to evicted recipients cannot retain more data.
      const retained = budget.bufferedBytes;
      for (const socket of sockets) {
        budget.send(socket as unknown as WebSocket, frame);
        socket.emit("close");
      }
      expect(retained).toBeGreaterThan(0);
      expect(budget.bufferedBytes).toBe(0);
    },
  );
});
