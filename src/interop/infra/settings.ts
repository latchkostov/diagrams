// Connections from settings (docs/research/imports.md § Connections from settings): a setting whose value
// names another component is a connection. Values are read here, in memory, only to find host names; nothing
// returned contains a value except host names of outside services and topic or group names. Every pattern is
// linear (no nested quantifiers), and values are cut to MAX_VALUE characters before any of them runs.

export const MAX_VALUE = 2_048;

export type SettingHit =
  /** A host: another component (`target`), or an outside one (`external`, with a product stencil if known). */
  | { type: "host"; name: string; host: string; scheme?: string }
  /** Kafka brokers ("kafka:9092,kafka-2:9092"). */
  | { type: "brokers"; name: string; hosts: string[] }
  /** Topics read or written; `dir` "guess" when the name doesn't say which. */
  | { type: "topics"; name: string; topics: string[]; dir: "read" | "write" | "guess" }
  /** A consumer group. */
  | { type: "group"; name: string; group: string }
  /** `*_FILE=/run/secrets/<name>`: a Compose secret. */
  | { type: "secret"; name: string; secret: string };

const SCHEMES = new Set([
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "mongodb+srv",
  "redis",
  "rediss",
  "sqlserver",
  "http",
  "https",
  "grpc",
  "grpcs",
  "amqp",
  "amqps",
  "nats",
]);
const HOST_SUFFIXES = ["HOST", "HOSTNAME", "SERVER", "ADDR", "ADDRESS", "ENDPOINT", "URL", "URI", "DSN"];
const READS = new Set(["INPUT", "IN", "SOURCE", "CONSUME", "CONSUMER", "SUBSCRIBE", "SUBSCRIPTION", "LISTEN"]);
const WRITES = new Set(["OUTPUT", "OUT", "SINK", "TARGET", "PUBLISH", "PRODUCE", "PRODUCER", "EVENTS"]);

/** "spring.kafka.bootstrap-servers" → "SPRING_KAFKA_BOOTSTRAP_SERVERS". */
const normalName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** Hosts that never name a component: this machine, any address, a bare IP. */
export function ignoredHost(host: string): boolean {
  return (
    !host ||
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "host.docker.internal" ||
    host.includes(":") ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** "user:pass@host:5432" → "host" (userinfo is cut first, the port after). Lower case. */
function hostOf(authority: string): string {
  const at = authority.lastIndexOf("@");
  let host = at >= 0 ? authority.slice(at + 1) : authority;
  if (host.startsWith("[")) return ""; // IPv6 literal
  const colon = host.indexOf(":");
  if (colon >= 0) host = host.slice(0, colon);
  return host.trim().toLowerCase();
}

const HOST_CHARS = /^[a-z0-9][a-z0-9.-]{0,252}$/;

/** `scheme://[user:pass@]host[:port][,host…]/…`: the scheme and the hosts. Undefined when it isn't a URL. */
export function parseUrl(value: string): { scheme: string; hosts: string[] } | undefined {
  const v = value.trim().replace(/^jdbc:/i, "");
  const sep = v.indexOf("://");
  if (sep <= 0 || sep > 16) return undefined;
  const scheme = v.slice(0, sep).toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return undefined;
  let rest = v.slice(sep + 3);
  // The authority ends at the first / ? or #. Userinfo goes before anything else looks at it.
  for (const end of ["/", "?", "#"]) {
    const i = rest.indexOf(end);
    if (i >= 0) rest = rest.slice(0, i);
  }
  const at = rest.lastIndexOf("@");
  if (at >= 0) rest = rest.slice(at + 1);
  const hosts = rest
    .split(",")
    .map(hostOf)
    .filter((h) => HOST_CHARS.test(h));
  return { scheme, hosts };
}

/** A bare `host[:port]` value ("redis:6379", "orders-api"), or undefined. */
function bareHost(value: string): string | undefined {
  const v = value.trim();
  if (!v || v.length > 260 || /[\s/@?#=;,]/.test(v)) return undefined;
  const host = hostOf(v);
  const port = v.slice(host.length);
  return HOST_CHARS.test(host) && (!port || /^:\d{1,5}$/.test(port)) ? host : undefined;
}

const TOPIC = /^[A-Za-z0-9._-]{1,249}$/;

/** What one setting says. `value` is used here only and never returned (apart from host and topic names). */
export function readSetting(rawName: string, rawValue: string): SettingHit[] {
  if (rawName.length > 256 || rawValue.length > MAX_VALUE) return [];
  const name = normalName(rawName);
  const value = rawValue.trim();
  if (!value) return [];
  const tokens = name.split("_").filter(Boolean);
  const last = tokens[tokens.length - 1];

  if (last === "FILE" && value.startsWith("/run/secrets/")) {
    const secret = value.slice("/run/secrets/".length);
    return /^[\w.-]{1,128}$/.test(secret) ? [{ type: "secret", name: rawName, secret }] : [];
  }
  if (name.endsWith("BOOTSTRAP_SERVERS") || last === "BROKERS" || last === "BROKER") {
    const hosts = value
      .split(",")
      .map((h) => bareHost(h.replace(/^[A-Za-z_]+:\/\//, "")))
      .filter((h): h is string => !!h && !ignoredHost(h));
    return hosts.length ? [{ type: "brokers", name: rawName, hosts }] : [];
  }
  if (last === "TOPIC" || last === "TOPICS") {
    const topics = value
      .split(",")
      .map((t) => t.trim())
      .filter((t) => TOPIC.test(t));
    if (!topics.length) return [];
    const dir = tokens.some((t) => READS.has(t)) ? "read" : tokens.some((t) => WRITES.has(t)) ? "write" : "guess";
    return [{ type: "topics", name: rawName, topics, dir }];
  }
  if (name === "CONSUMER_GROUP" || name.endsWith("_CONSUMER_GROUP") || name.endsWith("GROUP_ID")) {
    return TOPIC.test(value) ? [{ type: "group", name: rawName, group: value }] : [];
  }
  const url = parseUrl(value);
  if (url) {
    if (!SCHEMES.has(url.scheme)) return [];
    return url.hosts
      .filter((h) => !ignoredHost(h))
      .map((host) => ({ type: "host", name: rawName, host, scheme: url.scheme }) as const);
  }
  if (HOST_SUFFIXES.includes(last)) {
    const host = bareHost(value);
    return host && !ignoredHost(host) ? [{ type: "host", name: rawName, host }] : [];
  }
  return [];
}

/** Known outside hosts → the product's stencil (suffix match). */
const PRODUCTS: [string, string][] = [
  [".servicebus.windows.net", "azure.service-bus.queue"],
  [".vault.azure.net", "azure.key-vault"],
  [".azconfig.io", "azure.app-config"],
  [".documents.azure.com", "azure.cosmos-db"],
  [".database.windows.net", "azure.sql"],
  [".blob.core.windows.net", "azure.blob-storage"],
  [".redis.cache.windows.net", "azure.redis"],
  [".cache.amazonaws.com", "redis.cache"],
  [".s3.amazonaws.com", "aws.s3"],
  [".confluent.cloud", "confluent.cloud"],
  ["api.stripe.com", "stripe"],
  ["api.sendgrid.com", "sendgrid"],
  ["api.twilio.com", "twilio"],
  ["api.openai.com", "openai"],
  ["api.anthropic.com", "anthropic.claude"],
  ["hooks.slack.com", "slack"],
  ["slack.com", "slack"],
];

/** The product an outside host belongs to, or undefined. `scheme` picks the engine of a managed database. */
export function productOf(host: string, scheme?: string): string | undefined {
  if (host.endsWith(".rds.amazonaws.com"))
    return scheme?.startsWith("postgres") ? "postgres" : scheme === "mysql" ? "mysql" : "generic.database";
  if (/^sqs\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) return "aws.sqs";
  return PRODUCTS.find(([suffix]) => host === suffix || host.endsWith(suffix))?.[1];
}

/** An outside host: has a dot, isn't internal. Only these become nodes when nothing in the files matches. */
export const isOutsideHost = (host: string) =>
  host.includes(".") && !/\.(local|internal|svc|cluster\.local|lan|home)$/.test(host);
