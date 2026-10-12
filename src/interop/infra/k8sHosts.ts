// Kubernetes DNS names, parsed before anything is looked up (docs/research/imports.md § Connections from
// settings). The syntax decides what a name means; the files only decide whether it names something drawn. A
// namespace the files don't contain stays unresolved, never re-read as a local name.

/** One reading of a host: a Service (in `namespace`, or the caller's), or a pod behind a headless Service. */
export interface ServiceHost {
  service: string;
  /** Absent: the caller's own namespace (Kubernetes' search path). */
  namespace?: string;
  /** A StatefulSet pod's hostname ("db-0"). */
  pod?: string;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A StatefulSet pod: "<statefulset>-<ordinal>". */
const ORDINAL = /^[a-z0-9-]{1,60}-\d{1,5}$/;

/**
 * The readings of `host`, most specific first:
 * - `svc.ns.svc[.cluster.local]` and `pod.svc.ns.svc[.cluster.local]`: exactly that, nothing else;
 * - `svc`: a Service in the caller's namespace;
 * - `svc.ns`, or a StatefulSet pod `db-0.db` in the caller's namespace (tried first, as the search path does);
 * - `db-0.db.ns`: a StatefulSet pod in `ns`.
 * Other names (`api.stripe.com`, `x.cluster.local`) have none.
 */
export function parseServiceHost(host: string): ServiceHost[] {
  const h = host.toLowerCase().replace(/\.$/, "");
  const suffix = /\.svc(?:\.cluster\.local)?$/.exec(h);
  const parts = (suffix ? h.slice(0, suffix.index) : h).split(".");
  if (!parts.every((p) => LABEL.test(p))) return [];
  if (suffix) {
    if (parts.length === 2) return [{ service: parts[0], namespace: parts[1] }];
    if (parts.length === 3) return [{ pod: parts[0], service: parts[1], namespace: parts[2] }];
    return [];
  }
  if (h.endsWith(".cluster.local")) return [];
  if (parts.length === 1) return [{ service: parts[0] }];
  if (parts.length === 2)
    return ORDINAL.test(parts[0])
      ? [
          { pod: parts[0], service: parts[1] },
          { service: parts[0], namespace: parts[1] },
        ]
      : [{ service: parts[0], namespace: parts[1] }];
  if (parts.length === 3 && ORDINAL.test(parts[0])) return [{ pod: parts[0], service: parts[1], namespace: parts[2] }];
  return [];
}

/** True when the syntax says in-cluster, whatever the files hold: never an outside API. */
export const inClusterSyntax = (host: string) => /\.svc(?:\.cluster\.local)?$|\.cluster\.local$/.test(host);

/** Strimzi's Service names: `<cluster>-kafka-bootstrap` and `<cluster>-kafka-brokers`. */
export function strimziCluster(service: string): string | undefined {
  const m = /^([a-z0-9-]{1,200})-kafka-(?:bootstrap|brokers)$/.exec(service);
  return m?.[1];
}

/**
 * The workloads a host can name, indexed by kind, namespace and name, and by namespace and name. Resolving a host
 * is a few map lookups however many workloads there are: a scan per host would make imports quadratic.
 */
export class WorkloadNames<W extends { key: string }> {
  private readonly byKind = new Map<string, W>();
  private readonly byName = new Map<string, W>();

  /** Adds a workload; the first one with a name in a namespace answers for that name, whatever its kind. */
  add(kind: string, namespace: string, name: string, workload: W): void {
    this.byKind.set(`${kind}\u0001${namespace}\u0001${name}`, workload);
    const named = `${namespace}\u0001${name}`;
    if (!this.byName.has(named)) this.byName.set(named, workload);
  }

  at(kind: string, namespace: string, name: string): W | undefined {
    return this.byKind.get(`${kind}\u0001${namespace}\u0001${name}`);
  }

  named(namespace: string, name: string): W | undefined {
    return this.byName.get(`${namespace}\u0001${name}`);
  }

  /**
   * What `host`, read from namespace `from`, reaches: a Service's targets (`services`, by `namespace\u0001name`), a
   * workload of that name, or a StatefulSet pod's StatefulSet. Undefined when it names nothing in the files.
   */
  resolve(host: string, from: string, services: ReadonlyMap<string, string[]>): string[] | undefined {
    for (const h of parseServiceHost(host)) {
      const ns = h.namespace ?? from;
      // A StatefulSet pod ("db-0") behind its headless Service: the StatefulSet itself, else the Service's targets.
      const sts = h.pod ? this.at("StatefulSet", ns, h.pod.replace(/-\d+$/, "")) : undefined;
      if (sts) return [sts.key];
      const w = this.named(ns, h.service);
      const found = services.get(`${ns}\u0001${h.service}`) ?? (w ? [w.key] : undefined);
      if (found) return found;
    }
    return undefined;
  }
}
