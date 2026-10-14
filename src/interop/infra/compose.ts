import { diagnostic } from "./graph";
import { t as tr } from "../../i18n";
import type { ImportGraph } from "./graph";
import { imageStencil, shortImage, withoutCredentials } from "./stencils";
import { MAX_VALUE } from "./settings";
import { Components, linkSettings, Links } from "./links";
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
    if (!doc) throw new ImportError(tr("importDetail.value0DoesntHoldADockercomposeFile", { value0: f.name }));
    top = merge(top, normalizeTop(doc)) as Record<string, unknown>;
  }
  const services = own(top, "services");
  if (!isMap(services) || !Object.keys(services).length)
    throw new ImportError(tr("importDetail.itHasNoServicesToDraw"));

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

  // `extends`: a service in this file, or in another file opened with it. Each other file is parsed once and
  // each resolved service is kept, so a web of extends costs one pass per service; a cycle stops where it closes.
  const pools = new Map<string, Record<string, unknown> | undefined>([["", services]]);
  const poolOf = (file: string) => {
    const key = baseName(file);
    if (!pools.has(key)) {
      const other = opened.get(key);
      const doc = other && readYaml(other.text, other.name).find(isMap);
      const theirs = doc && own(doc, "services");
      pools.set(key, isMap(theirs) ? theirs : undefined);
    }
    return pools.get(key);
  };
  const resolved = new Map<string, Record<string, unknown> | undefined>();
  const resolving = new Set<string>();
  const resolve = (name: string, poolKey = "", depth = 0): Record<string, unknown> | undefined => {
    const id = `${poolKey}\u0001${name}`;
    if (resolved.has(id)) return resolved.get(id);
    const svc = normalizeService(own(pools.get(poolKey), name));
    if (!svc || resolving.has(id)) return svc;
    resolving.add(id);
    let out: Record<string, unknown> = svc;
    const ext = own(svc, "extends");
    if (ext !== undefined) {
      delete svc.extends;
      const baseService = str(ext) ?? str(own(ext, "service"));
      const file = str(own(ext, "file"));
      const from = file ? baseName(file) : poolKey;
      if (file && !poolOf(file)) unread(`extends ${file}`);
      else if (baseService && depth < 10) {
        const base = resolve(baseService, from, depth + 1);
        if (base) out = merge(base, svc) as Record<string, unknown>;
      }
    }
    resolving.delete(id);
    resolved.set(id, out);
    return out;
  };

  for (const name of Object.keys(own(top, "volumes") && isMap(own(top, "volumes")) ? (top.volumes as object) : {}))
    g.notDrawn.push({ name, reason: diagnostic("importDetail.volume") });

  // ------------------------------------------------ pass 1: what gets drawn
  const components = new Components(g.components);
  const { byKey } = components;
  const stencilOf = (key: string) => components.stencilOf(key);
  const add = (c: Parameters<Components["add"]>[0]) => components.add(c);
  const infos: ServiceInfo[] = [];
  const hosts = new Map<string, string>();

  for (const name of Object.keys(services)) {
    const svc = resolve(name);
    if (!svc) {
      g.notDrawn.push({ name, reason: diagnostic("importDetail.notAServiceDefinition") });
      continue;
    }
    const profiles = list(own(svc, "profiles"))
      .map(str)
      .filter((p): p is string => !!p);
    if (profiles.length) {
      const names = profiles.map((p) => `“${p}”`).join(", ");
      g.notDrawn.push({ name, reason: diagnostic("importDetail.profiles", { count: profiles.length, names }) });
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
        // A key with no value (`KEY:` or a bare `- KEY`) overrides env_file too: it isn't that setting.
        if (v === undefined) env.delete(k);
        else env.set(k, v);
      }
    const build = own(svc, "build");
    const context = str(build) ?? str(own(build, "context"));
    const said = own(own(svc, "deploy"), "replicas") ?? own(svc, "scale");
    // A number, or digits after the file's own defaults ("${REPLICAS:-2}"): never `true` or `[1]`, which
    // Number() would read as 1.
    const count = typeof said === "string" ? interpolate(said.slice(0, 64)) : said;
    const replicas =
      typeof count === "number" || (typeof count === "string" && /^\d{1,5}$/.test(count)) ? Number(count) : NaN;
    add({
      key: name,
      label: name.slice(0, 120),
      sublabel: image
        ? shortImage(image.replaceAll(OPAQUE, "*")).slice(0, 80)
        : context
          ? `built from ${withoutCredentials(context)}`.slice(0, 80)
          : undefined,
      hint: { name: name.slice(0, 120), image: image?.slice(0, 512), env: [...env.keys()].slice(0, 500) },
      // A count the file sets, one included (single-point reads it). Unset stays unset: Compose files are mostly
      // for one machine, where one replica is the default, not a claim.
      ...(Number.isInteger(replicas) && replicas >= 1 && replicas <= 10_000 ? { props: { replicas } } : {}),
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
  if (!g.components.length) throw new ImportError(tr("importDetail.theresNothingToDrawEveryService"));

  // ------------------------------------------------ pass 2: connections
  const links = new Links(components);
  const flow = links.flow.bind(links);
  const dep = links.dep.bind(links);
  const isBroker = (key: string) => links.isBroker(key);
  const isGateway = (key: string) => links.isGateway(key);
  const secretNames: string[] = [];
  const secrets = (name: string) => {
    if (!secretNames.includes(name)) secretNames.push(name);
    return add({
      key: "\u0002secrets",
      // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
      label: "Compose secrets",
      hint: { name: "secrets" },
      stencil: "generic.secret-store",
    });
  };
  const configNames = new Map<string, Set<string>>();
  const clusters = g.components.filter((c) => stencilOf(c.key) === "kafka.cluster").map((c) => c.key);

  for (const { key, svc, env } of infos) {
    linkSettings(
      components,
      links,
      key,
      // Long values are skipped before anything (interpolation included) looks at them.
      [...env].filter(([, raw]) => raw.length <= MAX_VALUE).map(([name, raw]) => [name, interpolate(raw)] as const),
      {
        host: (host) => hosts.get(host),
        outside: () => true,
        cluster: (brokers) => brokers.map((h) => hosts.get(h)).find((t) => t !== undefined && byKey.has(t)),
        onlyCluster: clusters.length === 1 ? clusters[0] : undefined,
        topic: (cluster, name) =>
          add({
            key: `\u0004${cluster ?? ""}\u0001${name}`,
            label: name.slice(0, 120),
            hint: { name },
            stencil: !cluster || stencilOf(cluster) === "kafka.cluster" ? "kafka.topic" : "generic.topic",
          }),
        clusterNode: (cluster) => cluster,
        secretFile: (name, evidence) => dep(key, secrets(name), "secret", evidence),
      },
    );

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
        // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
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
      // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
      const users = add({ key: "\u0002users", label: "Users", hint: { name: "users" }, stencil: "client.user" });
      flow(users, key, "sync", { source: "ports" });
    }
  }
  const secretsNode = byKey.get("\u0002secrets");
  if (secretsNode)
    secretsNode.sublabel =
      secretNames.join(", ").length <= 32 ? secretNames.join(", ") : `${secretNames.length} secrets`;

  // A flow wins over a dependency for the same pair, including a flow through one of a cluster's topics.
  const { topicCluster } = links;
  g.links = links.list().map((d) => {
    const names = d.relation === "config" ? configNames.get(d.from) : undefined;
    return names ? { ...d, props: { settings: [...names].map((key) => ({ key })) } } : d;
  });

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
        g.notes.push(
          diagnostic("importDetail.value0IsOnValue1ShownIn", {
            value0: info.key,
            value1: { list: nets, english: "and" },
            value2: net,
          }),
        );
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
