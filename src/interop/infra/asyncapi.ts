import type { Evidence, ImportComponent, ImportGraph, ImportLink } from "./graph";
import type { DiagramGroup } from "../../model/types";
import { parseUrl } from "./settings";
import { ImportError, isMap, list, own, readYaml, str } from "./yaml";

// AsyncAPI 2.x and 3.x → ImportGraph (docs/research/imports.md § Mapping: AsyncAPI). Our own reader: the
// official parser compiles schemas with `new Function`, which the CSP forbids. A document describes one
// application, from its own point of view. In 3.x `send` means it sends; 2.x inverts the words: `publish` means
// others publish *to* it (it receives) and `subscribe` means it sends. Several documents join on the channel:
// the same address on the same server (protocol family and host) is one node, so a producer in one file and a
// consumer in another become one flow. `$ref`s are followed inside the opened files only, never fetched.

export interface SourceFile {
  name: string;
  text: string;
}

/** `$ref` limits: references followed in a row, and in all for one import. */
export const REF_LIMITS = { depth: 32, total: 10_000 } as const;
/** The "Imported traffic" simulation: this rate at each entry point, for this long. */
export const IMPORTED_TRAFFIC = { ratePerSec: 1, seconds: 120 } as const;

const REMOTE = "a remote reference, never fetched: open that file too";

interface Doc {
  file: string;
  root: Record<string, unknown>;
  v2: boolean;
}

const baseName = (path: string) => path.replace(/^.*[\\/]/, "").toLowerCase();

/** A JSON pointer ("/components/messages/OrderPlaced") inside `root`, or undefined. */
function pointerGet(root: unknown, pointer: string): unknown {
  if (!pointer) return root;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    let part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    try {
      part = decodeURIComponent(part);
    } catch {
      return undefined;
    }
    if (Array.isArray(cur)) cur = /^\d+$/.test(part) ? cur[Number(part)] : undefined;
    else cur = own(cur, part);
    if (cur === undefined) return undefined;
  }
  return cur;
}

// ---------------------------------------------------------------- protocols → stencils

const FAMILY: Record<string, string> = {
  "kafka-secure": "kafka",
  amqps: "amqp",
  amqp1: "amqp",
  "secure-mqtt": "mqtt",
  mqtt5: "mqtt",
  https: "http",
  wss: "ws",
  stomps: "stomp",
};
const familyOf = (protocol: string) => FAMILY[protocol] ?? protocol;
const SIMPLE: Record<string, string> = {
  sns: "aws.sns",
  sqs: "aws.sqs",
  googlepubsub: "gcp.pubsub",
  pulsar: "pulsar.topic",
  nats: "nats.subject",
  redis: "redis.stream",
  mqtt: "mqtt.broker",
};
const NAMES: Record<string, string> = {
  kafka: "Kafka",
  amqp: "RabbitMQ",
  mqtt: "MQTT",
  sns: "Amazon SNS",
  sqs: "Amazon SQS",
  googlepubsub: "Pub/Sub",
  pulsar: "Pulsar",
  nats: "NATS",
  redis: "Redis",
  servicebus: "Service Bus",
  http: "HTTP",
  ws: "WebSocket",
};
/** Protocols with no stencil of their own: drawn as a Topic or a Queue, and listed as a guess. */
const BROKERED = new Set(["solace", "ibmmq", "jms", "anypointmq", "stomp"]);

interface ChannelKind {
  id: string;
  queue?: boolean;
  guess?: { evidence: string; alternatives: string[] };
}

function channelKind(family: string, host: string, bindings: Record<string, unknown> | undefined): ChannelKind {
  const amqp = own(bindings, "amqp");
  const queue =
    str(own(amqp, "is")) === "queue" || /queue/i.test(str(own(own(bindings, family), "destinationType")) ?? "");
  const serviceBus = family === "servicebus" || host.endsWith(".servicebus.windows.net");
  if (family === "kafka" || (!family && own(bindings, "kafka")))
    return {
      id: host.endsWith(".confluent.cloud")
        ? "confluent.cloud"
        : /\.kafka\.[a-z0-9-]+\.amazonaws\.com$/.test(host)
          ? "aws.msk"
          : "kafka.topic",
    };
  if (serviceBus && (family === "amqp" || family === "servicebus"))
    return { id: queue ? "azure.service-bus.queue" : "azure.service-bus.topic", queue };
  if (family === "amqp" || (!family && amqp)) return { id: queue ? "rabbitmq.queue" : "rabbitmq.exchange", queue };
  if (SIMPLE[family]) return { id: SIMPLE[family], queue: family === "sqs" };
  const id = queue ? "generic.queue" : "generic.topic";
  const other = queue ? "generic.topic" : "generic.queue";
  if (BROKERED.has(family)) return { id, queue, guess: { evidence: family, alternatives: [other] } };
  if (family === "http" || family === "ws" || family === "mercure")
    return {
      id,
      guess: { evidence: `${family} channels are drawn as topics`, alternatives: ["generic.webhook", other] },
    };
  if (family) return { id, queue, guess: { evidence: `protocol ${family}`, alternatives: [other] } };
  return { id, queue };
}

const toneOf = (host: string): DiagramGroup["tone"] =>
  /\.(windows\.net|azure\.com|azure-api\.net)$/.test(host)
    ? "azure"
    : /\.amazonaws\.com$/.test(host)
      ? "aws"
      : /\.(googleapis\.com|gcp\.)/.test(host)
        ? "gcp"
        : "neutral";

const DEAD_LETTER = /(^|[.\-_/])(dlq|dlt|dead[-_.]?letters?)([.\-_/]|$)/i;
const SCHEMA_FORMAT = /avro|protobuf/i;

// ---------------------------------------------------------------- the reader

/** A message as the import uses it: its name (the simulation's message type) and an Avro or Protobuf format. */
type Message = { name?: string; contentType?: string };

interface Server {
  id: string;
  family: string;
  /** host[:port], as the file names it; `hostname` without the port. */
  host: string;
  hostname: string;
  label: string;
  registry?: string;
  avro?: boolean;
}

interface Channel {
  key: string;
  address: string;
  server?: Server;
  kinds: { kind: ChannelKind; doc: string; exchange?: string }[];
  partitions?: number;
  contentType?: string;
  producers: Set<string>;
  consumers: Set<string>;
}

export function readAsyncApi(files: readonly SourceFile[]): ImportGraph {
  const docs: Doc[] = [];
  const byName = new Map<string, Doc>();
  for (const f of files) {
    for (const root of readYaml(f.text, f.name)) {
      if (!isMap(root)) continue;
      const version = str(own(root, "asyncapi")) ?? "";
      if (!/^[23]\./.test(version)) throw new ImportError(`${f.name} isn't an AsyncAPI 2.x or 3.x document.`);
      const doc = { file: f.name, root, v2: version.startsWith("2.") };
      docs.push(doc);
      if (!byName.has(baseName(f.name))) byName.set(baseName(f.name), doc);
    }
  }
  if (!docs.length) throw new ImportError("It has no AsyncAPI document to read.");

  const g: ImportGraph = {
    format: "AsyncAPI",
    title: "",
    source: files.map((f) => f.name.replace(/^.*[\\/]/, "")).join(", "),
    components: [],
    links: [],
    groups: [],
    notDrawn: [],
    unread: [],
    notes: [],
  };
  const unread = (name: string, reason: string) => {
    if (!g.unread.some((l) => l.name === name)) g.unread.push({ name: name.slice(0, 160), reason });
  };

  // ------------------------------------------------ $ref: local (and opened files) only, cycles and depth bounded
  let followed = 0;
  const deref = (value: unknown, doc: Doc): { value: unknown; doc: Doc } | undefined => {
    const seen = new Set<string>();
    let cur = value;
    let d = doc;
    for (let depth = 0; isMap(cur) && typeof own(cur, "$ref") === "string"; depth++) {
      const ref = own(cur, "$ref") as string;
      if (++followed > REF_LIMITS.total) throw new ImportError("It has too many references ($ref) to follow.");
      if (depth >= REF_LIMITS.depth) return void unread(`$ref ${ref}`, "more than 32 references in a row");
      const hash = ref.indexOf("#");
      const file = hash < 0 ? ref : ref.slice(0, hash);
      if (file) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return void unread(`$ref ${ref}`, REMOTE);
        const other = byName.get(baseName(file));
        if (!other) return void unread(`$ref ${ref}`, "not among the files you opened");
        d = other;
      }
      const at = `${d.file}#${hash < 0 ? "" : ref.slice(hash + 1)}`;
      if (seen.has(at)) return void unread(`$ref ${ref}`, "a reference cycle");
      seen.add(at);
      cur = pointerGet(d.root, hash < 0 ? "" : ref.slice(hash + 1));
      if (cur === undefined) return void unread(`$ref ${ref}`, "points at nothing in the file");
    }
    return { value: cur, doc: d };
  };
  const get = (value: unknown, doc: Doc) => deref(value, doc)?.value;

  // Every remote reference is listed, used or not: nothing is ever fetched.
  for (const doc of docs) {
    const stack: unknown[] = [doc.root];
    while (stack.length) {
      const v = stack.pop();
      if (!v || typeof v !== "object") continue;
      const ref = own(v, "$ref");
      if (typeof ref === "string") {
        const file = ref.split("#")[0];
        if (/^[a-z][a-z0-9+.-]*:/i.test(file)) unread(`$ref ${ref}`, REMOTE);
        else if (file && !byName.has(baseName(file))) unread(`$ref ${ref}`, "not among the files you opened");
      }
      stack.push(...(Array.isArray(v) ? v : Object.values(v)));
    }
  }

  // ------------------------------------------------ servers: one boundary per host and protocol family
  const servers = new Map<string, Server>();
  const serversOf = (doc: Doc) => {
    const out = new Map<string, Server>();
    const all = get(own(doc.root, "servers"), doc);
    if (!isMap(all)) return out;
    for (const name of Object.keys(all)) {
      const s = get(all[name], doc);
      if (!isMap(s)) continue;
      const protocol = (str(own(s, "protocol")) ?? "").toLowerCase();
      const family = familyOf(protocol);
      const raw = doc.v2 ? (str(own(s, "url")) ?? "") : (str(own(s, "host")) ?? "");
      const host = raw
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .replace(/[/?#].*$/, "")
        .replace(/^.*@/, "")
        .toLowerCase()
        .slice(0, 200);
      const id = `${family}\u0001${host}`;
      let server = servers.get(id);
      if (!server) {
        const hostname = host.replace(/:\d+$/, "");
        const name = hostname.endsWith(".servicebus.windows.net")
          ? "Service Bus"
          : (NAMES[family] ?? (protocol || "Server"));
        server = { id, family, host, hostname, label: host ? `${name} · ${host}` : name };
        servers.set(id, server);
      }
      const registry = str(own(own(get(own(s, "bindings"), doc), "kafka"), "schemaRegistryUrl"));
      const registryHost = registry && parseUrl(registry)?.hosts[0];
      if (registryHost) server.registry = registryHost;
      out.set(name, server);
    }
    return out;
  };

  // ------------------------------------------------ apps, channels and the flows between them
  const components = new Map<string, ImportComponent>();
  const add = (c: ImportComponent) => {
    if (!components.has(c.key)) {
      components.set(c.key, c);
      g.components.push(c);
    }
    return components.get(c.key)!;
  };
  const channels = new Map<string, Channel>();
  const flows = new Map<string, ImportLink>();
  const flow = (from: string, to: string, props: Record<string, unknown>, evidence: Evidence) => {
    const id = `${from}\u0001${to}`;
    const prev = flows.get(id);
    if (!prev) return void flows.set(id, { from, to, relation: "flow", kind: "async", props, evidence });
    // The same flow from another document: one edge, message types joined.
    const filter = [...new Set([...list(prev.props?.filter), ...list(props.filter)])];
    if (filter.length) prev.props = { ...prev.props, filter };
  };
  const apps: { key: string; title: string; sends: { channel: string; message?: string }[]; receives: string[] }[] = [];
  const usedMessages = new Set<unknown>();
  const usedChannels = new Set<unknown>();

  for (const doc of docs) {
    const info = get(own(doc.root, "info"), doc);
    const title = (str(own(info, "title")) ?? doc.file.replace(/^.*[\\/]/, "")).trim().slice(0, 120) || "Application";
    const appKey = `\u0005${title.toLowerCase()}`;
    add({ key: appKey, label: title, hint: { name: title } });
    const found = apps.find((a) => a.key === appKey);
    const app = found ?? { key: appKey, title, sends: [], receives: [] };
    if (!found) apps.push(app);
    const docServers = serversOf(doc);
    const contentDefault = str(own(doc.root, "defaultContentType"));
    const channelMap = get(own(doc.root, "channels"), doc);
    const channelKeys = new Map<unknown, string>();
    if (isMap(channelMap))
      for (const key of Object.keys(channelMap)) {
        const c = get(channelMap[key], doc);
        if (isMap(c) && !channelKeys.has(c)) channelKeys.set(c, key);
      }

    /** A message's name, and whether its schema is Avro or Protobuf. */
    const messageOf = (raw: unknown, key?: string): Message | undefined => {
      const m = get(raw, doc);
      if (!isMap(m)) return undefined;
      usedMessages.add(m);
      const payload = own(m, "payload");
      const format = [str(own(m, "contentType")), str(own(m, "schemaFormat")), str(own(payload, "schemaFormat"))]
        .filter(Boolean)
        .find((f) => SCHEMA_FORMAT.test(f!));
      const name = (str(own(m, "name")) ?? str(own(m, "messageId")) ?? key ?? str(own(m, "title")))?.slice(0, 120);
      return {
        name,
        contentType: format?.split(";")[0] ?? (SCHEMA_FORMAT.test(contentDefault ?? "") ? contentDefault : undefined),
      };
    };
    const some = (x: Message | undefined): x is Message => !!x;
    /** One message, or 2.x's `oneOf` list. */
    const messagesOf = (raw: unknown): Message[] => {
      const m = get(raw, doc);
      const oneOf = own(m, "oneOf");
      if (Array.isArray(oneOf)) return oneOf.map((x) => messageOf(x)).filter(some);
      return [messageOf(m)].filter(some);
    };
    /** 3.x: a channel's messages, a map by name. */
    const channelMessages = (raw: unknown): Message[] => {
      const m = get(raw, doc);
      return isMap(m)
        ? Object.keys(m)
            .map((k) => messageOf(m[k], k))
            .filter(some)
        : [];
    };

    /** The channel's node, joined with every other document's channel of that address and server. */
    const channelNode = (chKey: string, c: Record<string, unknown>) => {
      usedChannels.add(c);
      const address = (doc.v2 ? chKey : (str(own(c, "address")) ?? chKey)).slice(0, 200);
      const bindings = get(own(c, "bindings"), doc);
      const names = doc.v2
        ? list(own(c, "servers")).map(str)
        : list(own(c, "servers")).map((r) => {
            const ref = str(own(r, "$ref")) ?? "";
            return ref.startsWith("#/servers/") ? decodeURIComponent(ref.slice(10)) : undefined;
          });
      const candidates = [...docServers.entries()].filter(([n]) => !names.filter(Boolean).length || names.includes(n));
      // Several servers and no say: the one whose protocol has a binding on the channel, else the first.
      const server = (candidates.find(([, s]) => isMap(bindings) && Object.hasOwn(bindings, s.family)) ??
        candidates[0])?.[1];
      const key = `\u0004${server?.id ?? ""}\u0002${address}`;
      let ch = channels.get(key);
      if (!ch) {
        ch = { key, address, server, kinds: [], producers: new Set(), consumers: new Set() };
        channels.set(key, ch);
      }
      const kind = channelKind(server?.family ?? "", server?.hostname ?? "", isMap(bindings) ? bindings : undefined);
      const exchange = str(own(own(own(bindings, "amqp"), "exchange"), "name"));
      ch.kinds.push({ kind, doc: title, exchange });
      const partitions = Number(own(own(bindings, "kafka"), "partitions"));
      if (Number.isInteger(partitions) && partitions > 0 && partitions <= 10_000)
        ch.partitions = Math.max(ch.partitions ?? 0, partitions);
      if (!doc.v2)
        for (const m of channelMessages(own(c, "messages"))) if (m.contentType) ch.contentType = m.contentType;
      return ch;
    };
    const groupOf = (bindings: unknown) => {
      const group = get(own(get(bindings, doc), "kafka"), doc);
      const id = get(own(group, "groupId"), doc);
      const values = str(id) ? [str(id)] : [str(own(id, "const")), ...list(own(id, "enum")).map(str)].filter(Boolean);
      return values.length === 1 ? values[0]!.slice(0, 120) : undefined;
    };
    const connect = (action: "send" | "receive", ch: Channel, messages: Message[], bindings: unknown, what: string) => {
      for (const m of messages) if (m.contentType) ch.contentType = m.contentType;
      const names = [...new Set(messages.map((m) => m.name).filter((n): n is string => !!n))];
      const evidence: Evidence = { source: "spec", name: what };
      if (action === "send") {
        ch.producers.add(appKey);
        app.sends.push({ channel: ch.key, message: names[0] });
        flow(
          appKey,
          ch.key,
          {
            ...(names.length === 1 ? { emits: names[0] } : {}),
            ...(DEAD_LETTER.test(ch.address) ? { dlq: true } : {}),
          },
          evidence,
        );
      } else {
        ch.consumers.add(appKey);
        app.receives.push(ch.key);
        const group = groupOf(bindings);
        flow(ch.key, appKey, { ...(names.length ? { filter: names } : {}), ...(group ? { group } : {}) }, evidence);
      }
    };
    const resolveChannel = (raw: unknown, what: string) => {
      const c = get(raw, doc);
      const key = isMap(c) ? channelKeys.get(c) : undefined;
      if (!isMap(c) || key === undefined) return void unread(what, "its channel couldn't be found");
      return channelNode(key, c);
    };

    if (doc.v2) {
      // 2.x: the words are from the other side. `subscribe`: this app sends; `publish`: it receives.
      for (const [c, key] of channelKeys)
        for (const [verb, action] of [
          ["subscribe", "send"],
          ["publish", "receive"],
        ] as const) {
          const op = get(own(c, verb), doc);
          if (!isMap(op)) continue;
          const ch = channelNode(key, c as Record<string, unknown>);
          connect(
            action,
            ch,
            messagesOf(own(op, "message")),
            own(op, "bindings"),
            str(own(op, "operationId")) ?? `${verb} ${key}`,
          );
        }
    } else {
      const ops = get(own(doc.root, "operations"), doc);
      if (isMap(ops))
        for (const opKey of Object.keys(ops)) {
          const op = get(ops[opKey], doc);
          const action = str(own(op, "action"));
          if (!isMap(op) || (action !== "send" && action !== "receive")) {
            unread(`operation ${opKey}`, "no send or receive action");
            continue;
          }
          const ch = resolveChannel(own(op, "channel"), `operation ${opKey}`);
          if (!ch) continue;
          const messages =
            own(op, "messages") !== undefined ? list(own(op, "messages")).flatMap((m) => messagesOf(m)) : [];
          const fromChannel = messages.length
            ? messages
            : channelMessages(own(get(own(op, "channel"), doc), "messages"));
          connect(action, ch, fromChannel, own(op, "bindings"), opKey);
          // A request with a reply: the answer comes back on the reply channel.
          const reply = get(own(op, "reply"), doc);
          if (isMap(reply)) {
            const back = resolveChannel(own(reply, "channel"), `operation ${opKey} (reply)`);
            if (back)
              connect(
                action === "send" ? "receive" : "send",
                back,
                own(reply, "messages") !== undefined
                  ? list(own(reply, "messages")).flatMap((m) => messagesOf(m))
                  : channelMessages(own(get(own(reply, "channel"), doc), "messages")),
                undefined,
                `${opKey} (reply)`,
              );
          }
        }
    }

    // Unused and undrawn: listed, never dropped silently.
    for (const [c, key] of channelKeys)
      if (!usedChannels.has(c)) g.notDrawn.push({ name: key, reason: `no operation in ${title} uses it` });
    const comps = get(own(doc.root, "components"), doc);
    const msgs = get(own(comps, "messages"), doc);
    if (isMap(msgs))
      for (const k of Object.keys(msgs)) {
        const m = get(msgs[k], doc);
        if (m !== undefined && !usedMessages.has(m)) g.notDrawn.push({ name: k, reason: "a message no channel uses" });
      }
    for (const [what, field] of [
      ["security scheme", "securitySchemes"],
      ["payload schema", "schemas"],
    ] as const) {
      const n = Object.keys(isMap(own(comps, field)) ? (own(comps, field) as object) : {}).length;
      if (n)
        g.notDrawn.push({
          name: `${title}: ${n} ${what}${n === 1 ? "" : "s"}`,
          reason: "not components of the system",
        });
    }
  }

  // ------------------------------------------------ channels: stencils, boundaries, notes
  for (const ch of channels.values()) {
    // A queue binding wins over an exchange for the same address (the queue is what consumers read).
    const queue = ch.kinds.find((k) => k.kind.queue);
    const chosen = queue ?? ch.kinds[0];
    const exchanges = ch.kinds.filter((k) => k.exchange && k !== queue);
    if (queue && exchanges.length)
      g.notes.push(
        `${ch.address} is a queue; ${exchanges[0].doc} sends to it through the exchange “${exchanges[0].exchange}”`,
      );
    add({
      key: ch.key,
      label: ch.address,
      hint: { name: ch.address },
      stencil: chosen.kind.id,
      ...(chosen.kind.guess ? { guess: chosen.kind.guess } : {}),
      ...(ch.server?.host ? { group: ch.server.id } : {}),
      ...(ch.partitions || ch.contentType
        ? {
            props: {
              ...(ch.partitions ? { partitions: ch.partitions } : {}),
              ...(ch.contentType ? { contentType: ch.contentType } : {}),
            },
          }
        : {}),
    });
    if (ch.server && ch.contentType) ch.server.avro = true;
    if (ch.consumers.size && !ch.producers.size) g.notes.push(`${ch.address} has no producer in these files`);
  }
  const used = new Set([...channels.values()].map((c) => c.server?.id));
  g.groups = [...servers.values()]
    .filter((s) => s.host && used.has(s.id))
    .map((s) => ({ key: s.id, label: s.label.slice(0, 120), tone: toneOf(s.hostname) }));

  // ------------------------------------------------ Schema Registry: from a Kafka server's binding, or for Avro
  const deps: ImportLink[] = [];
  for (const server of servers.values()) {
    if (server.family !== "kafka" || (!server.registry && !server.avro)) continue;
    const registry = add({
      key: `\u0006${server.registry ?? server.id}`,
      label: server.registry ?? "Schema Registry",
      hint: { name: "schema registry" },
      stencil: "kafka.schema-registry",
    });
    if (!server.registry)
      g.notes.push(`Schema Registry added: messages on ${server.host || "Kafka"} use Avro or Protobuf`);
    const users = new Set(
      [...channels.values()].filter((c) => c.server === server).flatMap((c) => [...c.producers, ...c.consumers]),
    );
    for (const user of users)
      if (!deps.some((d) => d.from === user && d.to === registry.key))
        deps.push({
          from: user,
          to: registry.key,
          relation: "depends",
          evidence: { source: "spec", name: "schemaRegistryUrl" },
        });
  }
  g.links = [...flows.values(), ...deps];

  // ------------------------------------------------ Imported traffic: where messages start
  const sent = new Set(apps.flatMap((a) => a.sends.map((s) => s.channel)));
  let entries = apps.filter((a) => a.sends.length && !a.receives.some((c) => sent.has(c)));
  if (!entries.length) entries = apps.filter((a) => a.sends.length).slice(0, 1);
  g.traffic = entries.map((a) => ({
    key: a.key,
    messageType: a.sends.find((s) => s.message)?.message,
    ratePerSec: IMPORTED_TRAFFIC.ratePerSec,
  }));

  // A document whose channels couldn't be read draws nothing worth opening: say why instead.
  if (!channels.size) {
    const why = g.unread[0];
    throw new ImportError(
      why
        ? `Nothing in it could be drawn: ${why.name} (${why.reason}).`
        : "Nothing in it could be drawn: no operation sends or receives on a channel.",
    );
  }
  g.title = apps.length === 1 ? apps[0].title : `${apps.length} services`;
  return g;
}
