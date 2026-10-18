import { RELAY_LIMITS } from "../../../src/collab/transport/relayProtocol";

export interface ServerConfig {
  host: string;
  port: number;
  base: string;
  origin?: string;
  allowedOrigins: string[];
  trustProxy: boolean;
  logIps: boolean;
  metrics: boolean;
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
  return {
    host,
    port: integer("PORT", 8080, 0, 65535),
    base,
    origin: env.LD_ORIGIN === undefined ? undefined : origin(env.LD_ORIGIN),
    allowedOrigins: env.LD_ALLOWED_ORIGINS ? env.LD_ALLOWED_ORIGINS.split(",").map((s) => origin(s.trim())) : [],
    trustProxy: flag("TRUST_PROXY"),
    logIps: flag("LOG_IPS"),
    metrics: flag("METRICS"),
    roomCap: integer("ROOM_CAP", RELAY_LIMITS.roomCap, 1, 64),
    maxPayload: integer("MAX_PAYLOAD", RELAY_LIMITS.maxPayload, 10, RELAY_LIMITS.maxPayload),
    bytesPerWindow: integer("BYTES_PER_WINDOW", RELAY_LIMITS.bytesPerWindow),
    windowMs: integer("WINDOW_MS", RELAY_LIMITS.windowMs),
    framesPerSecond: integer("FRAMES_PER_SECOND", RELAY_LIMITS.framesPerSecond),
    frameBurst: integer("FRAME_BURST", RELAY_LIMITS.frameBurst),
    socketBufferBytes: integer("SOCKET_BUFFER_BYTES", RELAY_LIMITS.socketBufferBytes),
    totalBufferBytes: integer("TOTAL_BUFFER_BYTES", RELAY_LIMITS.totalBufferBytes),
    maxRooms: integer("MAX_ROOMS", RELAY_LIMITS.maxRooms),
    maxSockets: integer("MAX_SOCKETS", RELAY_LIMITS.maxSockets),
    socketsPerIp: integer("SOCKETS_PER_IP", RELAY_LIMITS.socketsPerIp),
    helloTimeoutMs: integer("HELLO_TIMEOUT_MS", RELAY_LIMITS.helloTimeoutMs),
    pingIntervalMs: integer("PING_INTERVAL_MS", RELAY_LIMITS.pingIntervalMs),
    missedPongs: integer("MISSED_PONGS", RELAY_LIMITS.missedPongs),
    idleTimeoutMs: integer("IDLE_TIMEOUT_MS", RELAY_LIMITS.idleTimeoutMs),
  };
}
