import { t as tr } from "../../i18n";
import type { Evidence, ImportComponent, ImportGraph, ImportLink } from "./graph";
import type { DiagramGroup } from "../../model/types";
import { parseUrl } from "./settings";
import { decodeSegment, Refs, type At, type Doc } from "./asyncapiRefs";
import { ImportError, isMap, list, own, readYaml, str } from "./yaml";

// AsyncAPI 2.x and 3.x → ImportGraph (docs/research/imports.md § Mapping: AsyncAPI). Our own reader: the
// official parser compiles schemas with `new Function`, which the CSP forbids. A document describes one
// application, from its own point of view. In 3.x `send` means it sends; 2.x inverts the words: `publish` means
// others publish *to* it (it receives) and `subscribe` means it sends. Several documents join on the channel:
// the same address on the same server (protocol family and host) is one node, so a producer in one file and a
// consumer in another become one flow. `$ref`s are followed inside the opened files only (asyncapiRefs.ts), each
// resolved value with the document that owns it.

export { REF_LIMITS } from "./asyncapiRefs";

export interface SourceFile {
  name: string;
  text: string;
}

/** The "Imported traffic" simulation: this rate at each entry point, for this long. */
export const IMPORTED_TRAFFIC = { ratePerSec: 1, seconds: 120 } as const;

const baseName = (path: string) => path.replace(/^.*[\\/]/, "").toLowerCase();

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
interface Message {
  name?: string;
  contentType?: string;
}

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

/** One channel node: every document's channel with this address on this server. */
interface Channel {
  key: string;
  address: string;
  server?: Server;
  kinds: { kind: ChannelKind; doc: string; exchange?: string }[];
  partitions?: number;
  contentType?: string;
  /** Message names declared on it, in any document. */
  messages: Set<string>;
  producers: Set<string>;
  consumers: Set<string>;
}

/** A resolved channel object, read once: its node and its messages, by object (for an operation's selection). */
interface ChannelRead {
  node: Channel;
  messages: Message[];
  byObject: Map<unknown, Message>;
}

/** Work units (channels, messages, operations read) for one import: a bound on what shared references can cost. */
export const WORK_BUDGET = 200_000;

export function readAsyncApi(files: readonly SourceFile[]): ImportGraph {
  const docs: Doc[] = [];
  const byName = new Map<string, Doc>();
  for (const f of files) {
    for (const root of readYaml(f.text, f.name)) {
      if (!isMap(root)) continue;
      const version = str(own(root, "asyncapi")) ?? "";
      if (!/^[23]\./.test(version))
        throw new ImportError(tr("importDetail.value0IsntAnAsyncAPI2xOr", { value0: f.name }));
      const doc = { file: f.name, root, v2: version.startsWith("2.") };
      docs.push(doc);
      if (!byName.has(baseName(f.name))) byName.set(baseName(f.name), doc);
    }
  }
  if (!docs.length) throw new ImportError(tr("importDetail.itHasNoAsyncAPIDocumentTo"));

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
  const refs = new Refs(byName);
  // Every remote reference is listed, used or not: nothing is ever fetched.
  for (const doc of docs) refs.scan(doc);
  let work = 0;
  const step = () => {
    if (++work > WORK_BUDGET) throw new ImportError(tr("importDetail.itHasTooMuchToRead"));
  };

  // ------------------------------------------------ servers: one boundary per host and protocol family
  const servers = new Map<string, Server>();
  const docServers = new Map<Doc, Map<string, Server>>();
  const serversOf = (doc: Doc) => {
    let out = docServers.get(doc);
    if (out) return out;
    out = new Map<string, Server>();
    docServers.set(doc, out);
    const all = refs.resolve(own(doc.root, "servers"), doc);
    if (!all || !isMap(all.value)) return out;
    for (const name of Object.keys(all.value)) {
      step();
      const s = refs.resolve(all.value[name], all.doc);
      if (!s || !isMap(s.value)) continue;
      const protocol = (str(own(s.value, "protocol")) ?? "").toLowerCase();
      const family = familyOf(protocol);
      const raw = s.doc.v2 ? (str(own(s.value, "url")) ?? "") : (str(own(s.value, "host")) ?? "");
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
        const label = hostname.endsWith(".servicebus.windows.net")
          ? "Service Bus"
          : (NAMES[family] ?? (protocol || "Server"));
        server = { id, family, host, hostname, label: host ? `${label} · ${host}` : label };
        servers.set(id, server);
      }
      const kafka = refs.child(refs.child(s, "bindings"), "kafka");
      const registry = str(own(kafka?.value, "schemaRegistryUrl"));
      const registryHost = registry && parseUrl(registry)?.hosts[0];
      if (registryHost) server.registry = registryHost;
      out.set(name, server);
    }
    return out;
  };

  // ------------------------------------------------ messages: read once per object
  const messageCache = new Map<unknown, { name?: string; contentType?: string }>();
  const usedMessages = new Set<unknown>();
  /** A message's name (its own, else the key it's listed under) and whether its schema is Avro or Protobuf. */
  const messageOf = (at: At | undefined, key?: string): Message | undefined => {
    if (!at || !isMap(at.value)) return undefined;
    const m = at.value;
    usedMessages.add(m);
    let parsed = messageCache.get(m);
    if (!parsed) {
      step();
      const payload = own(m, "payload");
      const format = [str(own(m, "contentType")), str(own(m, "schemaFormat")), str(own(payload, "schemaFormat"))]
        .filter((f): f is string => !!f)
        .find((f) => SCHEMA_FORMAT.test(f));
      const fallback = str(own(at.doc.root, "defaultContentType"));
      parsed = {
        name: (str(own(m, "name")) ?? str(own(m, "messageId")) ?? str(own(m, "title")))?.slice(0, 120),
        contentType: format?.split(";")[0] ?? (fallback && SCHEMA_FORMAT.test(fallback) ? fallback : undefined),
      };
      messageCache.set(m, parsed);
    }
    const name = parsed.name ?? key?.slice(0, 120) ?? at.name?.slice(0, 120);
    return { ...(name ? { name } : {}), ...(parsed.contentType ? { contentType: parsed.contentType } : {}) };
  };
  /** One message, or 2.x's `oneOf` list. */
  const messagesOf = (at: At | undefined): Message[] => {
    const oneOf = refs.child(at, "oneOf");
    if (oneOf && Array.isArray(oneOf.value)) {
      const out: Message[] = [];
      for (const item of oneOf.value) {
        const m = messageOf(refs.resolve(item, oneOf.doc));
        if (m) out.push(m);
      }
      return out;
    }
    const m = messageOf(at);
    return m ? [m] : [];
  };

  // ------------------------------------------------ channels: read once per object, joined across documents
  const channels = new Map<string, Channel>();
  const channelReads = new Map<unknown, ChannelRead>();
  const channelIndex = new Map<Doc, Map<unknown, string>>();
  /** The resolved channel objects of a document's `channels`, by object, with their keys. */
  const indexOf = (doc: Doc) => {
    let index = channelIndex.get(doc);
    if (index) return index;
    index = new Map();
    channelIndex.set(doc, index);
    const all = refs.resolve(own(doc.root, "channels"), doc);
    if (all && isMap(all.value))
      for (const key of Object.keys(all.value)) {
        step();
        const c = refs.resolve(all.value[key], all.doc);
        if (c && isMap(c.value) && !index.has(c.value)) index.set(c.value, key);
      }
    return index;
  };
  const appTitles = new Map<Doc, string>();
  const readChannel = (at: At, keyHint?: string): ChannelRead | undefined => {
    if (!isMap(at.value)) return undefined;
    const cached = channelReads.get(at.value);
    if (cached) return cached;
    step();
    const c = at.value;
    const key = indexOf(at.doc).get(c) ?? keyHint ?? at.name ?? "channel";
    const address = (at.doc.v2 ? key : (str(own(c, "address")) ?? key)).slice(0, 200);
    const bindings = refs.child(at, "bindings");
    const docServerMap = serversOf(at.doc);
    const names: string[] = [];
    for (const entry of list(own(c, "servers"))) {
      if (at.doc.v2) {
        const name = str(entry);
        if (name) names.push(name);
        continue;
      }
      const ref = str(own(entry, "$ref")) ?? "";
      if (!ref.startsWith("#/servers/")) continue;
      const name = decodeSegment(ref.slice("#/servers/".length));
      if (name === undefined) refs.report(`$ref ${ref}`, "a malformed reference");
      else names.push(name);
    }
    const candidates = [...docServerMap.entries()].filter(([n]) => !names.length || names.includes(n));
    // Several servers and no say: the one whose protocol has a binding on the channel, else the first.
    const server = (candidates.find(([, s]) => isMap(bindings?.value) && Object.hasOwn(bindings.value, s.family)) ??
      candidates[0])?.[1];
    const nodeKey = `\u0004${server?.id ?? ""}\u0002${address}`;
    let node = channels.get(nodeKey);
    if (!node) {
      node = {
        key: nodeKey,
        address,
        server,
        kinds: [],
        messages: new Set(),
        producers: new Set(),
        consumers: new Set(),
      };
      channels.set(nodeKey, node);
    }
    const bound = isMap(bindings?.value) ? bindings.value : undefined;
    node.kinds.push({
      kind: channelKind(server?.family ?? "", server?.hostname ?? "", bound),
      doc: appTitles.get(at.doc) ?? at.doc.file,
      exchange: str(own(own(own(bound, "amqp"), "exchange"), "name")),
    });
    const partitions = Number(own(own(bound, "kafka"), "partitions"));
    if (Number.isInteger(partitions) && partitions > 0 && partitions <= 10_000)
      node.partitions = Math.max(node.partitions ?? 0, partitions);
    const read: ChannelRead = { node, messages: [], byObject: new Map() };
    if (!at.doc.v2) {
      const msgs = refs.child(at, "messages");
      if (msgs && isMap(msgs.value))
        for (const k of Object.keys(msgs.value)) {
          const mAt = refs.resolve(msgs.value[k], msgs.doc);
          const m = messageOf(mAt, k);
          if (!m || !mAt) continue;
          read.messages.push(m);
          read.byObject.set(mAt.value, m);
          if (m.name) node.messages.add(m.name);
          if (m.contentType) node.contentType = m.contentType;
        }
    }
    channelReads.set(c, read);
    return read;
  };
  /** An operation's messages: picked from its channel's own list (keeping each one's key), else the whole list. */
  const selected = (list: At | undefined, channel: ChannelRead): Message[] => {
    if (!list || !Array.isArray(list.value) || !list.value.length) return channel.messages;
    const out: Message[] = [];
    for (const item of list.value) {
      step();
      const mAt = refs.resolve(item, list.doc);
      const m = (mAt && channel.byObject.get(mAt.value)) ?? messageOf(mAt);
      if (m) out.push(m);
    }
    return out;
  };

  // ------------------------------------------------ apps and the flows between them
  const components = new Map<string, ImportComponent>();
  const add = (c: ImportComponent) => {
    if (!components.has(c.key)) {
      components.set(c.key, c);
      g.components.push(c);
    }
    return components.get(c.key)!;
  };
  /** One edge per route: the same ends with a different group, message type or role are separate edges. */
  const flows = new Map<string, ImportLink>();
  const flow = (from: string, to: string, props: Record<string, unknown>, evidence: Evidence) => {
    const id = [from, to, str(props.emits) ?? "", str(props.group) ?? "", props.dlq ? "dlq" : ""].join("\u0001");
    const prev = flows.get(id);
    if (!prev) return void flows.set(id, { from, to, relation: "flow", kind: "async", props, evidence });
    // The same route from another document or operation: one edge, its accepted messages joined.
    if (Array.isArray(prev.props?.filter) && Array.isArray(props.filter))
      prev.props = { ...prev.props, filter: [...new Set([...prev.props.filter, ...props.filter])] };
    else if (!Array.isArray(props.filter) && prev.props) delete prev.props.filter;
  };
  interface App {
    key: string;
    title: string;
    sends: { channel: string; message?: string }[];
    receives: string[];
    deadLetters: { channel: Channel; messages: Message[] }[];
  }
  const apps: App[] = [];
  const usedChannels = new Set<unknown>();

  for (const doc of docs) {
    const info = refs.resolve(own(doc.root, "info"), doc);
    const title =
      (str(own(info?.value, "title")) ?? doc.file.replace(/^.*[\\/]/, "")).trim().slice(0, 120) || "Application";
    appTitles.set(doc, title);
    const appKey = `\u0005${title.toLowerCase()}`;
    add({ key: appKey, label: title, hint: { name: title } });
    const found = apps.find((a) => a.key === appKey);
    const app: App = found ?? { key: appKey, title, sends: [], receives: [], deadLetters: [] };
    if (!found) apps.push(app);
    const root: At = { value: doc.root, doc };

    const groupOf = (bindings: At | undefined) => {
      const id = refs.child(refs.child(bindings, "kafka"), "groupId");
      const v = id?.value;
      const values = str(v) ? [str(v)] : [str(own(v, "const")), ...list(own(v, "enum")).map(str)].filter(Boolean);
      return values.length === 1 ? values[0]!.slice(0, 120) : undefined;
    };
    const connect = (
      action: "send" | "receive",
      ch: Channel,
      messages: Message[],
      bindings: At | undefined,
      what: string,
    ) => {
      const names = [...new Set(messages.map((m) => m.name).filter((n): n is string => !!n))];
      for (const m of messages) if (m.contentType) ch.contentType = m.contentType;
      const evidence: Evidence = { source: "spec", name: what };
      if (action === "send") {
        // A send to a dead-letter channel is how the app fails messages: drawn as its broker's route below.
        if (DEAD_LETTER.test(ch.address)) return void app.deadLetters.push({ channel: ch, messages });
        ch.producers.add(appKey);
        app.sends.push({ channel: ch.key, message: names[0] });
        flow(appKey, ch.key, names.length === 1 ? { emits: names[0] } : {}, evidence);
      } else {
        ch.consumers.add(appKey);
        app.receives.push(ch.key);
        const group = groupOf(bindings);
        flow(ch.key, appKey, { ...(names.length ? { filter: names } : {}), ...(group ? { group } : {}) }, evidence);
      }
    };

    if (doc.v2) {
      // 2.x: the words are from the other side. `subscribe`: this app sends; `publish`: it receives.
      for (const [c, key] of indexOf(doc)) {
        const chAt: At = { value: c, doc };
        for (const [verb, action] of [
          ["subscribe", "send"],
          ["publish", "receive"],
        ] as const) {
          const op = refs.child(chAt, verb);
          if (!op || !isMap(op.value)) continue;
          step();
          const read = readChannel(chAt, key);
          if (!read) continue;
          usedChannels.add(c);
          const what = str(own(op.value, "operationId")) ?? `${verb} ${key}`;
          connect(action, read.node, messagesOf(refs.child(op, "message")), refs.child(op, "bindings"), what);
        }
      }
    } else {
      const ops = refs.child(root, "operations");
      if (ops && isMap(ops.value))
        for (const opKey of Object.keys(ops.value)) {
          step();
          const op = refs.resolve(ops.value[opKey], ops.doc);
          const action = str(own(op?.value, "action"));
          if (!op || !isMap(op.value) || (action !== "send" && action !== "receive")) {
            refs.report(`operation ${opKey}`, "no send or receive action");
            continue;
          }
          const chAt = refs.child(op, "channel");
          const read = chAt && readChannel(chAt);
          if (!chAt || !read) {
            refs.report(`operation ${opKey}`, "its channel couldn't be found");
            continue;
          }
          usedChannels.add(chAt.value);
          connect(action, read.node, selected(refs.child(op, "messages"), read), refs.child(op, "bindings"), opKey);
          // A request with a reply: the answer comes back on the reply channel.
          const reply = refs.child(op, "reply");
          if (reply && isMap(reply.value)) {
            const backAt = refs.child(reply, "channel");
            const back = backAt && readChannel(backAt);
            if (!backAt || !back) {
              refs.report(`operation ${opKey} (reply)`, "its channel couldn't be found");
              continue;
            }
            usedChannels.add(backAt.value);
            connect(
              action === "send" ? "receive" : "send",
              back.node,
              selected(refs.child(reply, "messages"), back),
              undefined,
              `${opKey} (reply)`,
            );
          }
        }
    }

    // Unused and undrawn: listed, never dropped silently.
    for (const [c, key] of indexOf(doc))
      if (!usedChannels.has(c))
        g.notDrawn.push({ name: key, reason: tr("importDetail.noOperationInValue0UsesIt", { value0: title }) });
    const comps = refs.child(root, "components");
    const msgs = refs.child(comps, "messages");
    if (msgs && isMap(msgs.value))
      for (const k of Object.keys(msgs.value)) {
        const m = refs.resolve(msgs.value[k], msgs.doc);
        if (m && !usedMessages.has(m.value))
          g.notDrawn.push({ name: k, reason: tr("importDetail.aMessageNoChannelUses") });
      }
    for (const [what, field] of [
      ["security scheme", "securitySchemes"],
      ["payload schema", "schemas"],
    ] as const) {
      const n = Object.keys(isMap(own(comps?.value, field)) ? (own(comps?.value, field) as object) : {}).length;
      if (n)
        g.notDrawn.push({
          name: `${title}: ${n} ${what}${n === 1 ? "" : "s"}`,
          reason: tr("importDetail.notComponentsOfTheSystem"),
        });
    }
  }

  // ------------------------------------------------ dead letters: the broker's route, as the simulation uses it
  // An app that sends what it couldn't handle to a dead-letter channel fails messages it read from one of its
  // inputs. Only a broker's dead-letter route catches failed deliveries in Live (src/sim/topology.ts), so the
  // route goes from that input to the dead-letter channel. With no single input to point at, the send stays an
  // ordinary message and the report says so.
  for (const app of apps)
    for (const { channel, messages } of app.deadLetters) {
      const names = new Set(messages.map((m) => m.name).filter(Boolean));
      const inputs = [...new Set(app.receives)]
        .map((key) => channels.get(key)!)
        .filter((input) => input !== channel && input.server?.id === channel.server?.id);
      const matching = inputs.filter((input) => !names.size || [...names].some((n) => input.messages.has(n!)));
      const source = matching.length === 1 ? matching[0] : inputs.length === 1 ? inputs[0] : undefined;
      if (source) {
        channel.producers.add(source.key);
        flow(source.key, channel.key, { dlq: true }, { source: "spec", name: "dead letters" });
        g.notes.push(
          tr("importDetail.value0IsTheDeadletterRouteOf", {
            value0: channel.address,
            value1: source.address,
            value2: app.title,
          }),
        );
      } else {
        channel.producers.add(app.key);
        const only = names.size === 1 ? [...names][0] : undefined;
        app.sends.push({ channel: channel.key, message: only });
        flow(app.key, channel.key, only ? { emits: only } : {}, { source: "spec", name: "dead letters" });
        g.notes.push(tr("importDetail.value0SendsToValue1WhichInputs", { value0: app.title, value1: channel.address }));
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
        tr("importDetail.value0IsAQueueValue1Sends", {
          value0: ch.address,
          value1: exchanges[0].doc,
          value2: exchanges[0].exchange ?? "",
        }),
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
    if (ch.consumers.size && !ch.producers.size)
      g.notes.push(tr("importDetail.value0HasNoProducerInThese", { value0: ch.address }));
  }
  const used = new Set([...channels.values()].map((c) => c.server?.id));
  g.groups = [...servers.values()]
    .filter((s) => s.host && used.has(s.id))
    .map((s) => ({ key: s.id, label: s.label.slice(0, 120), tone: toneOf(s.hostname) }));

  // ------------------------------------------------ Schema Registry: from a Kafka server's binding, or for Avro
  const deps: ImportLink[] = [];
  const depKeys = new Set<string>();
  for (const server of servers.values()) {
    if (server.family !== "kafka" || (!server.registry && !server.avro)) continue;
    const registry = add({
      key: `\u0006${server.registry ?? server.id}`,
      // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
      label: server.registry ?? "Schema Registry",
      hint: { name: "schema registry" },
      stencil: "kafka.schema-registry",
    });
    if (!server.registry)
      g.notes.push(tr("importDetail.schemaRegistryAddedMessagesOnValue0", { value0: server.host || "Kafka" }));
    for (const c of channels.values()) {
      if (c.server !== server) continue;
      for (const user of [...c.producers, ...c.consumers]) {
        if (!components.get(user)?.key.startsWith("\u0005")) continue;
        const id = `${user}\u0001${registry.key}`;
        if (depKeys.has(id)) continue;
        depKeys.add(id);
        deps.push({
          from: user,
          to: registry.key,
          relation: "depends",
          evidence: { source: "spec", name: "schemaRegistryUrl" },
        });
      }
    }
  }
  g.links = [...flows.values(), ...deps];
  g.unread = refs.unread;

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
        ? tr("importDetail.nothingInItCouldBeDrawn", { value0: why.name, value1: why.reason })
        : tr("importDetail.nothingInItCouldBeDrawnMore"),
    );
  }
  g.title = apps.length === 1 ? apps[0].title : `${apps.length} services`;
  return g;
}
