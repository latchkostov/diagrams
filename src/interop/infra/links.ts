import { getStencil } from "../../stencils/registry";
import { inferRelation } from "../../stencils/relations";
import type { EdgeRelation } from "../../model/types";
import { LIMITS } from "../native";
import type { Evidence, ImportComponent, ImportLink } from "./graph";
import { pickFor } from "./stencils";
import { isOutsideHost, MAX_VALUE, productOf, readSetting } from "./settings";
import { ImportError } from "./yaml";

// What every reader that infers connections shares (docs/research/imports.md § Connections from settings): the
// components drawn so far, the links between them (deduplicated, under the validator's edge budget while the graph
// is built), and the settings rules. Compose and Kubernetes differ only in how a host or a broker list names a
// component, which they pass in as a SettingsScope.

/** The components drawn so far, by key, with their stencils (resolved once). */
export class Components {
  readonly byKey = new Map<string, ImportComponent>();
  constructor(private readonly out: ImportComponent[]) {}

  /** Adds `c` unless its key is drawn already; either way, the key. */
  add(c: ImportComponent): string {
    if (!this.byKey.has(c.key)) {
      this.byKey.set(c.key, c);
      this.out.push(c);
    }
    return c.key;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  stencilOf(key: string): string {
    const c = this.byKey.get(key);
    if (!c) return "generic.service";
    if (c.stencil) return c.stencil;
    const pick = pickFor(c);
    return "id" in pick ? pick.id : "generic.service";
  }
}

/** Links found so far: one flow per direction of a pair, one dependency per pair and relation. */
export class Links {
  readonly flows = new Map<string, ImportLink>();
  readonly deps = new Map<string, ImportLink>();
  /** Flow route ids by their ends and kind, so a later reader can find and enrich a route without a scan. */
  private readonly routes = new Map<string, Set<string>>();
  /** A topic's cluster: a flow through one of its topics joins a service with the cluster too. */
  readonly topicCluster = new Map<string, string>();

  constructor(private readonly components: Components) {}

  private role(key: string) {
    return getStencil(this.components.stencilOf(key)).simRole;
  }
  isBroker(key: string): boolean {
    return ["topic", "queue", "stream"].includes(this.role(key)) || this.components.stencilOf(key) === "kafka.cluster";
  }
  isGateway(key: string): boolean {
    return this.role(key) === "gateway";
  }

  /** The validator's edge budget, enforced while the graph is built (before any layout runs). */
  private budget() {
    if (this.flows.size + this.deps.size >= LIMITS.maxEdges)
      throw new ImportError(
        `It would draw more than ${LIMITS.maxEdges.toLocaleString("en")} connections, the most a diagram holds.`,
      );
  }

  // A route is its ends, its kind, its consumer group and whether it carries dead letters: two subscriptions
  // forwarding to one queue are two groups, and a DLQ route beside an ordinary one is a route of its own.
  private static routeId(from: string, to: string, kind: string, props?: Record<string, unknown>) {
    const group = typeof props?.group === "string" ? props.group : "";
    return `${from}\u0001${to}\u0001${kind}\u0001${group}\u0001${props?.dlq === true ? "dlq" : ""}`;
  }
  private static pairId = (from: string, to: string, kind: string) => `${from}\u0001${to}\u0001${kind}`;

  private setFlow(id: string, link: ImportLink) {
    this.flows.set(id, link);
    const pair = Links.pairId(link.from, link.to, link.kind ?? "async");
    let ids = this.routes.get(pair);
    if (!ids) this.routes.set(pair, (ids = new Set()));
    ids.add(id);
  }

  flow(from: string, to: string, kind: "async" | "sync", evidence: Evidence, props?: Record<string, unknown>) {
    this.budget();
    const id = Links.routeId(from, to, kind, props);
    if (from !== to && !this.flows.has(id))
      this.setFlow(id, { from, to, relation: "flow", kind, evidence, ...(props ? { props } : {}) });
  }

  /**
   * A flow another source also implies (a KafkaUser's ACL): a route between the same ends that names no consumer
   * group takes this one's group, and one that names its own keeps it. Only when nothing joins the ends yet is it a
   * route of its own. Either way, one edge per consumer group, never a second one for the same ends.
   */
  flowOrEnrich(from: string, to: string, kind: "async" | "sync", evidence: Evidence, group?: string) {
    if (from === to) return;
    const ids = [...(this.routes.get(Links.pairId(from, to, kind)) ?? [])].filter(
      (id) => this.flows.get(id)?.props?.dlq !== true,
    );
    if (!ids.length) return this.flow(from, to, kind, evidence, group ? { group } : undefined);
    if (!group) return;
    const named = ids.filter((id) => typeof this.flows.get(id)!.props?.group === "string");
    if (named.length) return;
    // The ungrouped route takes the group: re-keyed, so a later flow in that group finds it.
    const old = this.flows.get(ids[0])!;
    const props = { ...old.props, group };
    this.flows.delete(ids[0]);
    this.routes.get(Links.pairId(from, to, kind))!.delete(ids[0]);
    const id = Links.routeId(from, to, kind, props);
    if (!this.flows.has(id)) this.setFlow(id, { ...old, props });
  }

  dep(
    from: string,
    to: string,
    relation: EdgeRelation,
    evidence: Evidence,
    props?: Record<string, unknown>,
    label?: string,
  ) {
    this.budget();
    if (from === to) return;
    const id = `${from}\u0001${to}\u0001${relation}`;
    const known = this.deps.get(id);
    if (!known) {
      this.deps.set(id, { from, to, relation, evidence, ...(props ? { props } : {}), ...(label ? { label } : {}) });
      return;
    }
    // One dependency per pair and relation, enriched by what a later source adds: a label it didn't have (how it
    // signs in), settings it didn't name, and evidence a person can trace (a resource or a setting) over the file's
    // bare structure.
    if (label && !known.label) known.label = label;
    if (props) known.props = { ...props, ...known.props };
    const traceable = (e: Evidence) => e.source === "resource" || e.source === "setting";
    if (traceable(evidence) && !traceable(known.evidence)) known.evidence = evidence;
  }

  /** A connection to `to`, as its stencil suggests: a dependency for typed stencils and brokers, else a Request. */
  connect(from: string, to: string, evidence: Evidence) {
    const relation = inferRelation(this.components.stencilOf(from), this.components.stencilOf(to));
    if (relation !== "flow") this.dep(from, to, relation, evidence);
    else if (this.isBroker(to)) this.dep(from, to, "depends", evidence);
    else this.flow(from, to, "sync", evidence);
  }

  /** Every link: the flows, then the dependencies no flow already joins (a flow wins over Depends on). */
  list(): ImportLink[] {
    const pairs = new Set<string>();
    for (const f of this.flows.values())
      for (const [a, b] of [
        [f.from, f.to],
        [f.to, f.from],
        [f.from, this.topicCluster.get(f.to)],
        [f.to, this.topicCluster.get(f.from)],
      ])
        if (b !== undefined) pairs.add(`${a}\u0001${b}`);
    return [
      ...this.flows.values(),
      ...[...this.deps.values()].filter((d) => d.relation !== "depends" || !pairs.has(`${d.from}\u0001${d.to}`)),
    ];
  }
}

/** How a reader's settings name its components. */
export interface SettingsScope {
  /**
   * A host → the component(s) it names in these files (a Kubernetes Service can select several workloads), or
   * undefined when it names nothing here. An empty list: it names something that isn't drawn.
   */
  host(host: string): string | readonly string[] | undefined;
  /** A host that names nothing in the files: is it outside (an External API), or just not in these files? */
  outside(host: string): boolean;
  /** Broker hosts → the Kafka cluster they name (a component's key or the reader's own id), if any. */
  cluster(hosts: string[]): string | undefined;
  /** The only cluster in the files: topics named without brokers belong to it. */
  onlyCluster?: string;
  /** The topic `name` on `cluster`, drawn: its key. */
  topic(cluster: string | undefined, name: string): string;
  /** The cluster as a node, when a service names its brokers but no topic: its key. */
  clusterNode(cluster: string): string | undefined;
  /** `*_FILE=/run/secrets/<name>` (Compose only). */
  secretFile?(name: string, evidence: Evidence): void;
}

/**
 * The connection rules over one component's settings (`[name, value]`, values in memory only). Hosts that name
 * another component give a Request or the target's dependency; outside hosts an External API or the product;
 * brokers and `*_TOPIC(S)` give flows through the cluster's topics, or Depends on the cluster when no topic is
 * named.
 */
export function linkSettings(
  components: Components,
  links: Links,
  key: string,
  settings: Iterable<readonly [string, string]>,
  scope: SettingsScope,
): void {
  const brokers: { cluster: string; name: string }[] = [];
  const topics: { topics: string[]; dir: "read" | "write" | "guess"; name: string }[] = [];
  let group: string | undefined;
  for (const [name, value] of settings) {
    if (value.length > MAX_VALUE) continue;
    for (const hit of readSetting(name, value)) {
      const evidence: Evidence = { source: "setting", name };
      if (hit.type === "host") {
        const target = scope.host(hit.host);
        if (target !== undefined) {
          for (const t of typeof target === "string" ? [target] : target)
            if (components.has(t)) links.connect(key, t, evidence);
        } else if (isOutsideHost(hit.host) && scope.outside(hit.host)) {
          const product = productOf(hit.host, hit.scheme);
          if (!product && hit.scheme && !/^https?$/.test(hit.scheme)) continue;
          const ext = components.add({
            key: `\u0003${hit.host}`,
            label: hit.host,
            hint: { name: hit.host },
            stencil: product ?? "generic.external-api",
          });
          links.connect(key, ext, evidence);
        }
      } else if (hit.type === "brokers") {
        const cluster = scope.cluster(hit.hosts);
        if (cluster) brokers.push({ cluster, name });
      } else if (hit.type === "topics") topics.push(hit);
      else if (hit.type === "group") group = hit.group;
      else if (hit.type === "secret") scope.secretFile?.(hit.secret, evidence);
    }
  }
  const cluster = brokers[0]?.cluster ?? (topics.length ? scope.onlyCluster : undefined);
  if (topics.length) {
    for (const t of topics)
      for (const name of t.topics) {
        // A topic belongs to its cluster: the same name on two clusters is two topics (no invented path).
        const topic = scope.topic(cluster, name);
        if (cluster) links.topicCluster.set(topic, cluster);
        const evidence: Evidence = { source: "setting", name: t.name };
        if (t.dir === "read")
          links.flow(topic, key, "async", { ...evidence, note: "reads" }, group ? { group } : undefined);
        else
          links.flow(key, topic, "async", {
            ...evidence,
            note: "writes",
            ...(t.dir === "guess" ? { guess: true } : {}),
          });
      }
  } else if (brokers.length) {
    const node = scope.clusterNode(brokers[0].cluster);
    if (node)
      links.dep(key, node, "depends", {
        source: "setting",
        name: brokers[0].name,
        note: "couldn't tell what it reads or writes",
      });
  }
}
