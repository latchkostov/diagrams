import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { ServerConfig } from "./config";
import { RELAY_CLOSE } from "../../../src/collab/transport/relayProtocol";

export interface Principal {
  ip: string;
}
export interface Refusal {
  code: number;
  reason: "origin" | "ip-cap" | "socket-cap" | "buffers" | "draining";
}
export interface Admission {
  admit(req: IncomingMessage): Principal | Refusal;
  release(principal: Principal): void;
}

export function createAdmission(config: ServerConfig): Admission {
  const ips = new Map<string, number>();
  return {
    admit(req) {
      const forwarded = req.headers["x-forwarded-for"];
      const ip =
        config.trustProxy && typeof forwarded === "string"
          ? (forwarded.split(",").at(-config.trustProxyHops)?.trim() ?? "")
          : (req.socket.remoteAddress ?? "");
      const expected = config.origin ?? `http://${req.headers.host}`;
      const origin = req.headers.origin;
      if (typeof origin !== "string" || (origin !== expected && !config.allowedOrigins.includes(origin)))
        return { code: RELAY_CLOSE.origin, reason: "origin" };
      if (!isIP(ip) || (ips.get(ip) ?? 0) >= config.socketsPerIp) return { code: RELAY_CLOSE.rate, reason: "ip-cap" };
      ips.set(ip, (ips.get(ip) ?? 0) + 1);
      return { ip };
    },
    release({ ip }) {
      const count = (ips.get(ip) ?? 1) - 1;
      if (count) ips.set(ip, count);
      else ips.delete(ip);
    },
  };
}
