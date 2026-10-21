import { RELAY_LIMITS } from "../../../src/collab/transport/relayProtocol";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  host: string;
  port: number;
  base: string;
  origin?: string;
  allowedOrigins: string[];
  trustProxy: boolean;
  trustProxyHops: number;
  logIps: boolean;
  metrics: boolean;
  static: boolean;
  staticDir: string;
  drainTimeoutMs: number;
  roomCap: number;
  maxPayload: number;
  bytesPerWindow: number;
  windowMs: number;
  framesPerSecond: number;
  frameBurst: number;
  socketBufferBytes: number;
  totalBufferBytes: number;
  maxRooms: number;
  maxSockets: number;
  socketsPerIp: number;
  helloTimeoutMs: number;
  pingIntervalMs: number;
  missedPongs: number;
  idleTimeoutMs: number;
  /** Knock-to-join rooms (P6): signature checks per socket and per room per window, and admission work waiting. */
  verifiesPerSocket: number;
  verifiesPerRoom: number;
  admissionJobs: number;
  admissionBytes: number;
}

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const integer = (name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) => {
    const raw = env[`LD_${name}`];
    const value = raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid LD_${name}`);
    return value;
  };
  const flag = (name: string) => {
    const raw = env[`LD_${name}`];
    if (raw !== undefined && raw !== "0" && raw !== "1") throw new Error(`Invalid LD_${name}`);
    return raw === "1";
  };
  const origin = (raw: string) => {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== raw) throw new Error("Invalid LD origin");
    return raw;
  };
  const base = env.LD_BASE ?? "/";
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error("Invalid LD_BASE");
  const host = env.LD_HOST ?? "0.0.0.0";
  if (!host || /[\s/]/.test(host)) throw new Error("Invalid LD_HOST");
  if (env.LD_STATIC !== undefined && !["on", "off"].includes(env.LD_STATIC)) throw new Error("Invalid LD_STATIC");
  if (env.LD_STATIC_DIR === "") throw new Error("Invalid LD_STATIC_DIR");
  return {
    host,
    port: integer("PORT", 8080, 0, 65535),
    base,
    origin: env.LD_ORIGIN === undefined ? undefined : origin(env.LD_ORIGIN),
    allowedOrigins: env.LD_ALLOWED_ORIGINS ? env.LD_ALLOWED_ORIGINS.split(",").map((s) => origin(s.trim())) : [],
    trustProxy: flag("TRUST_PROXY"),
    trustProxyHops: integer("TRUST_PROXY_HOPS", 1),
    logIps: flag("LOG_IPS"),
    metrics: flag("METRICS"),
    static: env.LD_STATIC !== "off",
    staticDir: env.LD_STATIC_DIR ?? fileURLToPath(new URL("../../../dist/", import.meta.url)),
    drainTimeoutMs: integer("DRAIN_TIMEOUT_MS", 10_000, 1, 2_147_483_647),
    roomCap: integer("ROOM_CAP", RELAY_LIMITS.roomCap, 1, 64),
    maxPayload: integer("MAX_PAYLOAD", RELAY_LIMITS.maxPayload, RELAY_LIMITS.minPayload, RELAY_LIMITS.maxPayload),
    bytesPerWindow: integer("BYTES_PER_WINDOW", RELAY_LIMITS.bytesPerWindow),
    windowMs: integer("WINDOW_MS", RELAY_LIMITS.windowMs),
    framesPerSecond: integer("FRAMES_PER_SECOND", RELAY_LIMITS.framesPerSecond),
    frameBurst: integer("FRAME_BURST", RELAY_LIMITS.frameBurst),
    socketBufferBytes: integer("SOCKET_BUFFER_BYTES", RELAY_LIMITS.socketBufferBytes, RELAY_LIMITS.closeFrameBytes),
    totalBufferBytes: integer("TOTAL_BUFFER_BYTES", RELAY_LIMITS.totalBufferBytes, RELAY_LIMITS.closeFrameBytes),
    maxRooms: integer("MAX_ROOMS", RELAY_LIMITS.maxRooms),
    maxSockets: integer("MAX_SOCKETS", RELAY_LIMITS.maxSockets),
    socketsPerIp: integer("SOCKETS_PER_IP", RELAY_LIMITS.socketsPerIp),
    helloTimeoutMs: integer("HELLO_TIMEOUT_MS", RELAY_LIMITS.helloTimeoutMs, 1, 2_147_483_647),
    pingIntervalMs: integer("PING_INTERVAL_MS", RELAY_LIMITS.pingIntervalMs, 1, 2_147_483_647),
    missedPongs: integer("MISSED_PONGS", RELAY_LIMITS.missedPongs),
    idleTimeoutMs: integer("IDLE_TIMEOUT_MS", RELAY_LIMITS.idleTimeoutMs),
    verifiesPerSocket: integer("VERIFY_PER_SOCKET", 2048),
    verifiesPerRoom: integer("VERIFY_PER_ROOM", 8192),
    admissionJobs: integer("ADMISSION_JOBS", 8),
    admissionBytes: integer("ADMISSION_BYTES", 4 * 1024 * 1024),
  };
}
