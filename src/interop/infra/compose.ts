import { getStencil } from "../../stencils/registry";
import { inferRelation } from "../../stencils/relations";
import type { EdgeRelation } from "../../model/types";
import type { Evidence, ImportComponent, ImportGraph, ImportLink } from "./graph";
import { resolveStencil, shortImage, imageStencil } from "./stencils";
import { isOutsideHost, MAX_VALUE, productOf, readSetting } from "./settings";
import { bare, ImportError, isMap, list, own, readYaml, str } from "./yaml";

// docker-compose → ImportGraph (docs/research/imports.md § Mapping: docker-compose). Several files merge the
// way Compose merges them (a base file, then its overrides). Anchors, merge keys and `x-` blocks are resolved
// by the YAML reader; `extends` here. Setting values are read in memory to find hosts and never kept.

export interface SourceFile {
  name: string;
  text: string;
}

const NOT_OPENED = "not among the files you opened";
/** Stands for a variable with no default in the file: it can never form a host name. */
const OPAQUE = "\u0000";

/**
 * Compose interpolation with the file's own defaults only: `${VAR:-x}` and `${VAR-x}` give `x`; any other
 * variable stays opaque (no environment, no `.env`). `$$` is a literal `$`. One linear pass.
 */
export function interpolate(value: string): string {
  if (!value.includes("$")) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (c !== "$") {
      out += c;
      i++;
    } else if (value[i + 1] === "$") {
      out += "$";
      i += 2;
    } else if (value[i + 1] === "{") {
      const end = value.indexOf("}", i + 2);
      if (end < 0) return out + OPAQUE;
      const body = value.slice(i + 2, end);
      const m = /^[A-Za-z_]\w*(?::?-)/.exec(body);
      out += m ? body.slice(m[0].length) : OPAQUE;
      i = end + 1;
    } else {
      const m = /^[A-Za-z_]\w*/.exec(value.slice(i + 1, i + 257));
      out += m ? OPAQUE : "$";
      i += m ? m[0].length + 1 : 1;
    }
  }
  return out;
}

const baseName = (path: string) => path.replace(/^.*[\\/]/, "").toLowerCase();
const isOverride = (name: string) => /\.override\.ya?ml$/i.test(name);

/** "KEY=VALUE" lines (a .env file), values in memory only. */
function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/).slice(0, 10_000)) {
    const line = raw.trim().replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    if (!line || line.startsWith("#") || eq <= 0) continue;
    out.set(
      line.slice(0, eq).trim(),
      line
        .slice(eq + 1)
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2"),
    );
  }
  return out;
}

// ---------------------------------------------------------------- merging (Compose's rules, simplified)

/** Fields that may be a list or a map: as a map, so a later file's entries merge by key. */
function asMap(v: unknown, kv: boolean): Record<string, unknown> | undefined {
  if (isMap(v)) {
    const out = bare();
    for (const k of Object.keys(v)) out[k] = v[k];
    return out;
  }
  if (!Array.isArray(v)) return undefined;
  const out = bare();
  for (const item of v) {
    const s = str(item);
    if (s === undefined) continue;
    const eq = kv ? s.indexOf("=") : -1;
    if (eq > 0) out[s.slice(0, eq)] = s.slice(eq + 1);
    else out[s] = kv ? null : {};
  }
  return out;
}

function normalizeService(svc: unknown): Record<string, unknown> | undefined {
  if (!isMap(svc)) return undefined;
  const out = bare();
  for (const k of Object.keys(svc)) out[k] = svc[k];
  for (const [key, kv] of [
    ["environment", true],
    ["depends_on", false],
    ["networks", false],
  ] as const) {
    const m = asMap(own(svc, key), kv);
    if (m) out[key] = m;
  }
  return out;
}

const REPLACE = new Set(["command", "entrypoint", "test", "profiles"]);

function merge(a: unknown, b: unknown, key = ""): unknown {
  if (b === undefined) return a;
  if (isMap(a) && isMap(b)) {
    const out = bare();
    for (const k of Object.keys(a)) out[k] = a[k];
    for (const k of Object.keys(b)) out[k] = merge(own(a, k), b[k], k);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && !REPLACE.has(key)) {
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    return [...a, ...b.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  return b;
}

function normalizeTop(doc: Record<string, unknown>): Record<string, unknown> {
  const out = bare();
  for (const k of Object.keys(doc)) out[k] = doc[k];
  const services = own(doc, "services");
  if (isMap(services)) {
    const s = bare();
    for (const name of Object.keys(services)) s[name] = normalizeService(services[name]) ?? services[name];
    out.services = s;
  }
  return out;
}

// ---------------------------------------------------------------- the reader

interface ServiceInfo {
  key: string;
  svc: Record<string, unknown>;
  env: Map<string, string>;
  networks: string[];
}

export function readCompose(files: readonly SourceFile[], others: readonly SourceFile[] = []): ImportGraph {
  const ordered = [...files].sort((a, b) => Number(isOverride(a.name)) - Number(isOverride(b.name)));
  let top: Record<string, unknown> = bare();
  for (const f of ordered) {
    const doc = readYaml(f.text, f.name).find(isMap);
    if (!doc) throw new ImportError(`${f.name} doesn't hold a docker-compose file.`);
    top = merge(top, normalizeTop(doc)) as Record<string, unknown>;
  }
  const services = own(top, "services");
  if (!isMap(services) || !Object.keys(services).length)
    throw new ImportError("It has no services to draw (docker-compose files list them under services:).");

  const opened = new Map([...files, ...others].map((f) => [baseName(f.name), f]));
  const first = files[0]?.name ?? "docker-compose.yml";
  const fileTitle = baseName(first).replace(/\.ya?ml$/, "");
  const g: ImportGraph = {
    format: "docker-compose",
    title: str(own(top, "name"))?.trim().slice(0, 120) || fileTitle,
    source: files.map((f) => f.name.replace(/^.*[\\/]/, "")).join(", "),
    components: [],
    links: [],
    groups: [],
    notDrawn: [],
    unread: [],
    notes: [],
  };
  const unread = (name: string, reason = NOT_OPENED) => {
    if (!g.unread.some((l) => l.name === name)) g.unread.push({ name, reason });
  };

  for (const inc of list(own(top, "include"))) {
    const path = str(inc) ?? str(own(inc, "path")) ?? str(list(own(inc, "path"))[0]);
    if (path && !opened.has(baseName(path))) unread(`include ${path}`);
  }

  // `extends`: a service in this file, or in another file opened with it.
  const resolve = (name: string, from: Record<string, unknown>, depth = 0): Record<string, unknown> | undefined => {
    const svc = normalizeService(own(from, name));
    if (!svc) return undefined;
    const ext = own(svc, "extends");
    if (ext === undefined) return svc;
    delete svc.extends;
    const baseService = str(ext) ?? str(own(ext, "service"));
    const file = str(own(ext, "file"));
    if (!baseService || depth > 10) return svc;
    let pool = from;
    if (file) {
      const other = opened.get(baseName(file));
      const doc = other && readYaml(other.text, other.name).find(isMap);
      const theirs = doc && own(doc, "services");
      if (!isMap(theirs)) {
        unread(`extends ${file}`);
        return svc;
      }
      pool = theirs;
    }
    const base = resolve(baseService, pool, depth + 1);
    return base ? (merge(base, svc) as Record<string, unknown>) : svc;
  };

  for (const name of Object.keys(own(top, "volumes") && isMap(own(top, "volumes")) ? (top.volumes as object) : {}))
    g.notDrawn.push({ name, reason: "volume" });

  // ------------------------------------------------ pass 1: what gets drawn
  const byKey = new Map<string, ImportComponent>();
  const infos: ServiceInfo[] = [];
  const hosts = new Map<string, string>();
  const stencilOf = (key: string): string => {
    const c = byKey.get(key);
    if (!c) return "generic.service";
    if (c.stencil) return c.stencil;
    const pick = resolveStencil(c.hint);
    return "id" in pick ? pick.id : "generic.service";
  };
  const add = (c: ImportComponent) => {
    if (!byKey.has(c.key)) {
      byKey.set(c.key, c);
      g.components.push(c);
    }
    return c.key;
  };

  for (const name of Object.keys(services)) {
    const svc = resolve(name, services);
    if (!svc) {
      g.notDrawn.push({ name, reason: "not a service definition" });
      continue;
    }
    const profiles = list(own(svc, "profiles"))
      .map(str)
      .filter((p): p is string => !!p);
    if (profiles.length) {
      const names = profiles.map((p) => `“${p}”`).join(", ");
      g.notDrawn.push({ name, reason: `only in profile${profiles.length > 1 ? "s" : ""} ${names}` });
      continue;
    }
    const rawImage = str(own(svc, "image"));
    const image = rawImage && interpolate(rawImage);
    const skip = imageStencil(image);
    if (typeof skip === "object") {
      g.notDrawn.push({ name, reason: skip.skip });
      continue;
    }
    const env = new Map<string, string>();
    for (const ref of [own(svc, "env_file")].flat()) {
      for (const entry of Array.isArray(ref) ? ref : [ref]) {
        const path = str(entry) ?? str(own(entry, "path"));
        if (!path) continue;
        const file = opened.get(baseName(path));
        if (file) for (const [k, v] of parseDotenv(file.text)) env.set(k, v);
        else unread(`env_file ${path}`);
      }
    }
    const environment = own(svc, "environment");
    if (isMap(environment))
      for (const k of Object.keys(environment)) {
        const v = str(environment[k]);
        if (v !== undefined) env.set(k, v);
      }
    const build = own(svc, "build");
    const context = str(build) ?? str(own(build, "context"));
    const replicas = Number(own(own(svc, "deploy"), "replicas") ?? own(svc, "scale"));
    add({
      key: name,
      label: name.slice(0, 120),
      sublabel: image
        ? shortImage(image.replaceAll(OPAQUE, "*")).slice(0, 80)
        : context
          ? `built from ${context}`.slice(0, 80)
          : undefined,
      hint: { name: name.slice(0, 120), image: image?.slice(0, 512), env: [...env.keys()].slice(0, 500) },
      ...(Number.isInteger(replicas) && replicas > 1 && replicas <= 10_000 ? { props: { replicas } } : {}),
    });
    const nets = own(svc, "networks");
    const networks = isMap(nets) ? Object.keys(nets) : [];
    infos.push({ key: name, svc, env, networks: networks.length ? networks : ["default"] });
    for (const alias of [name, str(own(svc, "container_name")), str(own(svc, "hostname"))])
      if (alias) hosts.set(alias.toLowerCase(), name);
    if (isMap(nets))
      for (const n of Object.keys(nets))
        for (const alias of list(own(nets[n], "aliases"))) {
          const a = str(alias);
          if (a) hosts.set(a.toLowerCase(), name);
        }
  }
  for (const info of infos)
    for (const link of list(own(info.svc, "links"))) {
      const [target, alias] = (str(link) ?? "").split(":");
      if (alias && byKey.has(target)) hosts.set(alias.toLowerCase(), target);
    }
  if (!g.components.length)
    throw new ImportError("There's nothing to draw: every service is in a profile or isn't a component.");

  // ------------------------------------------------ pass 2: connections
  const flows = new Map<string, ImportLink>();
  const deps = new Map<string, ImportLink>();
  const topicCluster = new Map<string, string>();
  const role = (key: string) => getStencil(stencilOf(key)).simRole;
  const isBroker = (key: string) =>
    ["topic", "queue", "stream"].includes(role(key)) || stencilOf(key) === "kafka.cluster";
  const isGateway = (key: string) => role(key) === "gateway";

  const flow = (
    from: string,
    to: string,
    kind: "async" | "sync",
    evidence: Evidence,
    props?: Record<string, unknown>,
  ) => {
    const id = `${from}\u0001${to}`;
    if (from !== to && !flows.has(id))
      flows.set(id, { from, to, relation: "flow", kind, evidence, ...(props ? { props } : {}) });
  };
  const dep = (
    from: string,
    to: string,
    relation: EdgeRelation,
    evidence: Evidence,
    props?: Record<string, unknown>,
  ) => {
    const id = `${from}\u0001${to}\u0001${relation}`;
    if (from !== to && !deps.has(id)) deps.set(id, { from, to, relation, evidence, ...(props ? { props } : {}) });
  };
  /** A connection to `to`, as its stencil suggests: a dependency for typed stencils and brokers, else a Request. */
  const connect = (from: string, to: string, evidence: Evidence) => {
    const relation = inferRelation(stencilOf(from), stencilOf(to));
    if (relation !== "flow") dep(from, to, relation, evidence);
    else if (isBroker(to)) dep(from, to, "depends", evidence);
    else flow(from, to, "sync", evidence);
  };
  const secretNames: string[] = [];
  const secrets = (name: string) => {
    if (!secretNames.includes(name)) secretNames.push(name);
    return add({
      key: "\u0002secrets",
      label: "Compose secrets",
      hint: { name: "secrets" },
      stencil: "generic.secret-store",
    });
  };
  const configNames = new Map<string, Set<string>>();
  const clusters = g.components.filter((c) => stencilOf(c.key) === "kafka.cluster").map((c) => c.key);

  for (const { key, svc, env } of infos) {
    const brokers: { cluster: string; name: string }[] = [];
    const topics: { topics: string[]; dir: "read" | "write" | "guess"; name: string }[] = [];
    let group: string | undefined;
    for (const [name, raw] of env) {
      // Long values are skipped before anything (interpolation included) looks at them.
      if (raw.length > MAX_VALUE) continue;
      for (const hit of readSetting(name, interpolate(raw))) {
        const evidence: Evidence = { source: "setting", name };
        if (hit.type === "host") {
          const target = hosts.get(hit.host);
          if (target) {
            if (byKey.has(target)) connect(key, target, evidence);
          } else if (isOutsideHost(hit.host)) {
            const product = productOf(hit.host, hit.scheme);
            if (!product && hit.scheme && !/^https?$/.test(hit.scheme)) continue;
            const ext = add({
              key: `\u0003${hit.host}`,
              label: hit.host,
              hint: { name: hit.host },
              stencil: product ?? "generic.external-api",
            });
            connect(key, ext, evidence);
          }
        } else if (hit.type === "brokers") {
          const target = hit.hosts.map((h) => hosts.get(h)).find((t) => t && byKey.has(t));
          if (target) brokers.push({ cluster: target, name });
        } else if (hit.type === "topics") topics.push(hit);
        else if (hit.type === "group") group = hit.group;
        else if (hit.type === "secret") dep(key, secrets(hit.secret), "secret", evidence);
      }
    }
    const cluster = brokers[0]?.cluster ?? (topics.length && clusters.length === 1 ? clusters[0] : undefined);
    if (topics.length) {
      const kafka = !cluster || stencilOf(cluster) === "kafka.cluster";
      for (const t of topics)
        for (const name of t.topics) {
          const topic = add({
            key: `\u0004${name}`,
            label: name.slice(0, 120),
            hint: { name },
            stencil: kafka ? "kafka.topic" : "generic.topic",
          });
          if (cluster) topicCluster.set(topic, cluster);
          const evidence: Evidence = { source: "setting", name: t.name };
          if (t.dir === "read")
            flow(topic, key, "async", { ...evidence, note: "reads" }, group ? { group } : undefined);
          else
            flow(key, topic, "async", { ...evidence, note: "writes", ...(t.dir === "guess" ? { guess: true } : {}) });
        }
    } else if (brokers.length)
      dep(key, brokers[0].cluster, "depends", {
        source: "setting",
        name: brokers[0].name,
        note: "couldn't tell what it reads or writes",
      });

    // The file's own structure: depends_on, links, network_mode, volumes_from.
    const targets = [
      ...Object.keys(isMap(own(svc, "depends_on")) ? (svc.depends_on as object) : {}),
      ...list(own(svc, "links")).map((l) => (str(l) ?? "").split(":")[0]),
      ...[str(own(svc, "network_mode"))].filter((m) => m?.startsWith("service:")).map((m) => m!.slice(8)),
      ...list(own(svc, "volumes_from"))
        .map((v) => (str(v) ?? "").split(":")[0])
        .filter((v) => v !== "container"),
    ];
    for (const target of targets) {
      if (!byKey.has(target) || target === key) continue;
      // A reverse proxy's depends_on names its upstreams: a real path in Live.
      if (isGateway(key) && !isBroker(target)) flow(key, target, "sync", { source: "depends_on" });
      else dep(key, target, "depends", { source: "depends_on" });
    }
    for (const s of list(own(svc, "secrets"))) {
      const name = str(s) ?? str(own(s, "source"));
      if (name) dep(key, secrets(name), "secret", { source: "secrets" });
    }
    for (const c of list(own(svc, "configs"))) {
      const name = str(c) ?? str(own(c, "source"));
      if (!name) continue;
      const store = add({
        key: "\u0002configs",
        label: "Compose configs",
        hint: { name: "configs" },
        stencil: "generic.config-store",
      });
      const set = configNames.get(key) ?? new Set();
      set.add(name);
      configNames.set(key, set);
      dep(key, store, "config", { source: "configs" });
    }
    if (publishesWeb(own(svc, "ports"), isGateway(key))) {
      const users = add({ key: "\u0002users", label: "Users", hint: { name: "users" }, stencil: "client.user" });
      flow(users, key, "sync", { source: "ports" });
    }
  }
  const secretsNode = byKey.get("\u0002secrets");
  if (secretsNode)
    secretsNode.sublabel =
      secretNames.join(", ").length <= 32 ? secretNames.join(", ") : `${secretNames.length} secrets`;

  // A flow wins over a dependency for the same pair, including a flow through one of a cluster's topics.
  const joined = (a: string, b: string) =>
    [...flows.values()].some(
      (f) =>
        (f.from === a && f.to === b) ||
        (f.from === b && f.to === a) ||
        (f.from === a && topicCluster.get(f.to) === b) ||
        (f.to === a && topicCluster.get(f.from) === b),
    );
  g.links = [
    ...flows.values(),
    ...[...deps.values()]
      .filter((d) => d.relation !== "depends" || !joined(d.from, d.to))
      .map((d) => {
        const names = d.relation === "config" ? configNames.get(d.from) : undefined;
        return names ? { ...d, props: { settings: [...names].map((key) => ({ key })) } } : d;
      }),
  ];

  // ------------------------------------------------ boundaries: networks, when they divide the services
  const drawn = infos.filter((i) => byKey.has(i.key));
  const named = [...new Set(drawn.flatMap((i) => i.networks).filter((n) => n !== "default"))];
  const single = drawn.filter((i) => i.networks.length === 1).length;
  if (named.length >= 2 && single >= drawn.length * 0.8) {
    const home = new Map(drawn.filter((i) => i.networks.length === 1).map((i) => [i.key, i.networks[0]]));
    for (const info of drawn) {
      const nets = info.networks.filter((n) => n !== "default");
      if (!nets.length) continue;
      let net = nets[0];
      if (nets.length > 1) {
        const score = (n: string) =>
          g.links.filter((l) => {
            const other = l.from === info.key ? l.to : l.to === info.key ? l.from : undefined;
            return other !== undefined && home.get(topicCluster.get(other) ?? other) === n;
          }).length;
        net = nets.reduce((best, n) => (score(n) > score(best) ? n : best), nets[0]);
        g.notes.push(`${info.key} is on ${nets.join(" and ")}; shown in ${net}`);
      }
      byKey.get(info.key)!.group = net;
    }
    for (const [topic, cluster] of topicCluster) {
      const c = byKey.get(topic);
      if (c) c.group = byKey.get(cluster)?.group;
    }
    const used = new Set(g.components.map((c) => c.group));
    g.groups = named.filter((n) => used.has(n)).map((n) => ({ key: n, label: n.slice(0, 120), tone: "neutral" }));
  }
  return g;
}

/** Publishes 80 or 443 (host or container side), or any port on a gateway. */
function publishesWeb(ports: unknown, gateway: boolean): boolean {
  const entries = list(ports);
  if (!entries.length) return false;
  if (gateway) return true;
  return entries.some((p) => {
    const nums = isMap(p)
      ? [own(p, "published"), own(p, "target")].map((n) => Number(n))
      : (str(p) ?? "")
          .split("/")[0]
          .split(":")
          .slice(-2)
          .map((n) => Number(n));
    return nums.some((n) => n === 80 || n === 443);
  });
}
