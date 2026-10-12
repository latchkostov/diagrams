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
