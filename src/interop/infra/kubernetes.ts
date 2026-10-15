import { importHpa, importKeda, importTrigger, workloadResources } from "./k8sScaling";
import { resourceLesson, type AutoscalingConfig, type KedaTrigger, type ScalingSummary } from "../../model/autoscaling";
import { scalingReasonCode } from "../../model/scalingReason";
import { diagnostic, diagnosticKey, type ImportText } from "./graph";
import { t as tr } from "../../i18n";
import type { Evidence, ImportComponent, ImportGraph } from "./graph";
import { imageStencil, shortImage } from "./stencils";
import { isOutsideHost, parseUrl, productOf } from "./settings";
import { Components, linkSettings, Links, type SettingsScope } from "./links";
import { inClusterSyntax, parseServiceHost, strimziCluster, WorkloadNames } from "./k8sHosts";
import { containerEnv, ENV_LIMITS, knownSettings, newEnvBudget } from "./k8sSettings";
import { ImportError, isMap, list, own, readYaml, str, YAML_LIMITS } from "./yaml";

// Kubernetes manifests → ImportGraph (docs/research/imports.md § Mapping: Kubernetes). Several files, each with
// several documents (and `kind: List`), are one diagram. Workloads are found by their pod template, so CRDs that
// wrap pods work without a table entry. Services aren't nodes: a request to one goes to the workloads its selector
// matches. Namespaces are boundaries. ConfigMaps and Secrets are dependencies named by their keys: ConfigMap
// values are read in memory like inline settings, to find hosts; a Secret's `data` and `stringData` never are.

export interface SourceFile {
  name: string;
  text: string;
}

/** Said for a Helm chart's templates: the import reads rendered output, never runs a template. */
export const HELM_TEMPLATE =
  "This looks like a Helm template ({{ .Values… }}). Run “helm template” and import its output.";

/** At most this many resources in one import (List items included). */
export const MAX_RESOURCES = 10_000;

const HELM = /\{\{-?\s*(?:\.Values|\.Release|\.Chart|\.Capabilities|include\s|template\s|toYaml\s)/;
// This is persisted in node subtitles. It is diagram content, identical in every UI language.
const NOT_IN_FILES = "not in these files";

interface Res {
  kind: string;
  /** The API group: "" for the core group, "apps", "kafka.strimzi.io"… */
  group: string;
  name: string;
  /** The namespace, "default" when the manifest doesn't say. */
  ns: string;
  obj: Record<string, unknown>;
}

interface Workload {
  res: Res;
  key: string;
  pod: Record<string, unknown>;
  labels: Record<string, unknown>;
  /** The main container's image (not a sidecar's). */
  image?: string;
}

const meta = (r: { obj: unknown }) => own(r.obj, "metadata");
const spec = (r: { obj: unknown }) => own(r.obj, "spec");
const at = (kind: string, ns: string, name: string) => `${kind}\u0001${ns}\u0001${name}`;
const nsName = (ns: string, name: string) => `${ns}\u0001${name}`;
const label = (s: string) => s.slice(0, 120);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : undefined;
};
/** A map's own string entries: labels, selectors, data. */
const entries = (v: unknown): [string, string][] =>
  isMap(v)
    ? Object.keys(v)
        .map((k) => [k, str(v[k])] as [string, string | undefined])
        .filter((e): e is [string, string] => e[1] !== undefined)
    : [];
const keysOf = (...maps: unknown[]) => maps.flatMap((m) => (isMap(m) ? Object.keys(m) : []));

/** Not components: listed in the report, never drawn. */
const NOT_A_COMPONENT = new Set([
  "PersistentVolumeClaim",
  "PersistentVolume",
  "StorageClass",
  "NetworkPolicy",
  "PodDisruptionBudget",
  "Role",
  "RoleBinding",
  "ClusterRole",
  "ClusterRoleBinding",
  "LimitRange",
  "ResourceQuota",
  "PriorityClass",
  "RuntimeClass",
  "Endpoints",
  "EndpointSlice",
  "Event",
  "ControllerRevision",
  "Lease",
  "MutatingWebhookConfiguration",
  "ValidatingWebhookConfiguration",
  "CustomResourceDefinition",
  "APIService",
  "IngressClass",
  "GatewayClass",
  "ReferenceGrant",
  "VerticalPodAutoscaler",
  "Certificate",
  "CertificateRequest",
  "Issuer",
  "ClusterIssuer",
  "TriggerAuthentication",
  "ClusterTriggerAuthentication",
]);
/**
 * Workloads by the Secrets they use, indexed once while the reader goes through them: a KafkaUser's workloads are
 * one lookup, not a scan of every workload for every user.
 */
export class SecretUsers {
  private readonly by = new Map<string, string[]>();
  add(ns: string, secret: string, key: string): void {
    const k = `${ns}\u0001${secret}`;
    const list = this.by.get(k);
    if (list) list.push(key);
    else this.by.set(k, [key]);
  }
  get(ns: string, secret: string): readonly string[] {
    return this.by.get(`${ns}\u0001${secret}`) ?? [];
  }
}

/** Strimzi kinds that are part of a Kafka cluster, not components of their own. */
const PART_OF_KAFKA = new Set([
  "KafkaNodePool",
  "KafkaUser",
  "KafkaRebalance",
  "KafkaConnector",
  "KafkaMirrorMaker",
  "KafkaMirrorMaker2",
  "KafkaBridge",
]);
/** Secret types that aren't application secrets: never drawn. */
const SECRET_TYPES: Record<string, string> = {
  "kubernetes.io/tls": "TLS certificate",
  "kubernetes.io/dockerconfigjson": "image-pull secret",
  "kubernetes.io/dockercfg": "image-pull secret",
  "kubernetes.io/service-account-token": "service account token",
};
/** Containers injected beside the application: the main container is another one. */
const SIDECARS = new Set([
  "istio-proxy",
  "linkerd-proxy",
  "envoy",
  "envoy-sidecar",
  "cloud-sql-proxy",
  "cloudsql-proxy",
  "oauth2-proxy",
  "vault-agent",
  "fluent-bit",
  "fluentd",
  "otel-collector",
  "datadog-agent",
]);

/** Ingress and Gateway classes → the gateway's stencil (else Load Balancer). */
const GATEWAYS: [RegExp, string][] = [
  [/nginx/, "nginx"],
  [/traefik/, "traefik"],
  [/haproxy/, "haproxy"],
  [/kong/, "kong"],
  [/istio/, "istio"],
  [/envoy|contour|^eg$/, "envoy"],
  [/^alb$|aws|lattice/, "aws.elb"],
  [/^gce|gke/, "gcp.cloud-load-balancing"],
  [/azure|agic|application-gateway/, "azure.app-gateway"],
];
const gatewayStencil = (cls: string | undefined) =>
  GATEWAYS.find(([re]) => cls && re.test(cls.toLowerCase()))?.[1] ?? "load-balancer";

/** Workload identity annotations on a ServiceAccount → the identity's stencil and label. */
const IDENTITIES: [annotation: string, stencil: string, valid: RegExp, label: (value: string, sa: string) => string][] =
  [
    ["azure.workload.identity/client-id", "azure.managed-identity", /^[0-9a-f-]{36}$/i, (_v, sa) => sa],
    [
      "eks.amazonaws.com/role-arn",
      "aws.iam-role",
      /^arn:aws[a-z-]{0,12}:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/,
      (v) => v.slice(v.lastIndexOf("/") + 1),
    ],
    [
      "iam.gke.io/gcp-service-account",
      "gcp.service-account",
      /^[a-z0-9-]{1,63}@[a-z0-9.-]{1,253}$/,
      (v) => v.slice(0, v.indexOf("@")),
    ],
  ];

/** A two-label host is outside the cluster only with a familiar top-level domain ("example.com", not "orders.shop"). */
const TLD = /^(?:com|net|org|io|dev|app|ai|co|cloud|eu|us|uk|de|fr|nl|ca|au|in|jp|me|info|biz|tech|xyz)$/;
/** Kinds that fold into the workload that owns them (`kubectl get all`): never a Deployment an operator owns. */
const FOLDABLE = new Set(["Pod", "ReplicaSet", "Job"]);

/** Every resource in the files: documents, and the items of `kind: List`. Values are read, never executed. */
function readResources(files: readonly SourceFile[], unread: (name: string, reason: ImportText) => void): Res[] {
  const out: Res[] = [];
  let documents = 0;
  for (const f of files) {
    const name = f.name.replace(/^.*[\\/]/, "");
    // A chart's templates aren't YAML yet: say how to get the rendered manifests rather than fail obscurely.
    if (HELM.test(f.text)) throw new ImportError(HELM_TEMPLATE);
    const docs = readYaml(f.text, name);
    documents += docs.length;
    if (documents > YAML_LIMITS.maxDocuments)
      throw new ImportError(tr("importDetail.theseFilesHoldMoreThanValue0", { value0: YAML_LIMITS.maxDocuments }));
    const queue: [unknown, number, number][] = docs.map((d, i) => [d, 0, i + 1]);
    for (let i = 0; i < queue.length; i++) {
      const [doc, depth, index] = queue[i];
      const kind = str(own(doc, "kind"));
      const items = own(doc, "items");
      if (kind?.endsWith("List") && Array.isArray(items)) {
        if (depth < 2) for (const item of items) queue.push([item, depth + 1, index]);
        continue;
      }
      const apiVersion = str(own(doc, "apiVersion"));
      if (!isMap(doc) || !kind || !apiVersion) {
        unread(`${name}, document ${index}`, diagnostic("importDetail.notAKubernetesResourceNoKind"));
        continue;
      }
      const m = meta({ obj: doc });
      const resName = str(own(m, "name")) ?? str(own(m, "generateName"));
      if (!resName) {
        unread(
          `${name}, document ${index}`,
          diagnostic("importDetail.aValue0WithNoName", { value0: kind.slice(0, 60) }),
        );
        continue;
      }
      if (out.length >= MAX_RESOURCES)
        throw new ImportError(tr("importDetail.theseFilesHoldMoreThanValue0More", { value0: MAX_RESOURCES }));
      const slash = apiVersion.lastIndexOf("/");
      out.push({
        kind: kind.slice(0, 120),
        group: slash > 0 ? apiVersion.slice(0, slash).slice(0, 120) : "",
        name: resName.slice(0, 253),
        ns: (str(own(m, "namespace")) ?? "").slice(0, 63) || "default",
        obj: doc,
      });
    }
  }
  return out;
}

/** The pod template of anything that runs pods: Deployment, StatefulSet, DaemonSet, Job, CronJob, Rollout… */
function podOf(r: Res): { pod: Record<string, unknown>; labels: Record<string, unknown> } | undefined {
  const s = spec(r);
  let template: unknown;
  if (r.group === "" && r.kind === "Pod") template = { metadata: meta(r), spec: s };
  else if (r.kind === "CronJob") template = own(own(own(s, "jobTemplate"), "spec"), "template");
  else if (r.group === "keda.sh" && r.kind === "ScaledJob") template = own(own(s, "jobTargetRef"), "template");
  else template = own(s, "template");
  const pod = own(template, "spec");
  if (!isMap(pod) || !Array.isArray(own(pod, "containers"))) return undefined;
  const labels = own(own(template, "metadata"), "labels");
  return { pod, labels: isMap(labels) ? labels : {} };
}

export function readKubernetes(files: readonly SourceFile[]): ImportGraph {
  const g: ImportGraph = {
    format: "Kubernetes",
    title: "",
    source: files.map((f) => f.name.replace(/^.*[\\/]/, "")).join(", "),
    components: [],
    links: [],
    groups: [],
    notDrawn: [],
    unread: [],
    notes: [],
  };
  const unread = (name: string, reason: ImportText) => {
    if (g.unread.length < 10_000) g.unread.push({ name, reason });
  };
  const resources = readResources(files, unread);
  if (!resources.length) throw new ImportError(tr("importDetail.theresNothingToDrawNoKubernetes"));

  /** Not drawn, grouped by kind and reason: "ServiceMonitor orders-api", "PersistentVolumeClaim ×4". */
  const skipped = new Map<string, { kind: string; reason: ImportText; names: string[] }>();
  const skip = (kind: string, name: string, reason: ImportText) => {
    const k = `${kind}\u0001${diagnosticKey(reason)}`;
    const entry = skipped.get(k) ?? { kind, reason, names: [] };
    entry.names.push(name);
    skipped.set(k, entry);
  };
  const note = (text: ImportText) => {
    if (!g.notes.some((n) => diagnosticKey(n) === diagnosticKey(text)) && g.notes.length < 200) g.notes.push(text);
  };

  // ------------------------------------------------ indexes
  const byAt = new Map<string, Res>();
  const namespaces = new Set<string>();
  /** Namespaces the files name (metadata.namespace or a Namespace): only those become boundaries. */
  const explicit = new Set<string>();
  for (const r of resources) {
    byAt.set(at(r.kind, r.ns, r.name), r);
    namespaces.add(r.ns);
    if (str(own(meta(r), "namespace"))) explicit.add(r.ns);
    if (r.group === "" && r.kind === "Namespace") {
      namespaces.add(r.name);
      explicit.add(r.name);
    }
  }
  const core = (kind: string) => resources.filter((r) => r.group === "" && r.kind === kind);
  const configMaps = new Map(core("ConfigMap").map((r) => [nsName(r.ns, r.name), r]));
  const secrets = new Map(core("Secret").map((r) => [nsName(r.ns, r.name), r]));
  const accounts = new Map(core("ServiceAccount").map((r) => [nsName(r.ns, r.name), r]));
  const strimzi = new Map(
    resources.filter((r) => r.group === "kafka.strimzi.io" && r.kind === "Kafka").map((r) => [nsName(r.ns, r.name), r]),
  );

  const components = new Components(g.components);
  const links = new Links(components);
  const add = (c: ImportComponent) => components.add(c);
  const groupOf = (key: string) => components.byKey.get(key)?.group;
  const handled = new Set<Res>();

  // ------------------------------------------------ workloads: anything with a pod template
  const workloads: Workload[] = [];
  /** Workloads by kind and name, and by name: what hosts, backends and scalers name. */
  const workloadNames = new WorkloadNames<Workload>();
  /** Workloads by namespace and pod label (`k=v`): a selector starts from its rarest pair. */
  const byLabel = new Map<string, Workload[]>();
  /** Pod labels of workloads that aren't drawn (a ZooKeeper image): a Service selecting them is known, not missing. */
  const skippedPods: { ns: string; labels: Record<string, unknown> }[] = [];
  /** The workload a Pod, ReplicaSet or Job belongs to: an owner in the files that runs pods itself. */
  const ownerWorkload = (r: Res): Res | undefined => {
    if (!FOLDABLE.has(r.kind)) return undefined;
    for (const o of list(own(meta(r), "ownerReferences"))) {
      const kind = str(own(o, "kind"));
      const name = str(own(o, "name"));
      const owner = kind && name ? byAt.get(at(kind, r.ns, name)) : undefined;
      if (owner && owner !== r && podOf(owner)) return owner;
    }
    return undefined;
  };
  for (const r of resources) {
    if (r.group === "" && r.kind === "Service") continue;
    const p = podOf(r);
    if (!p) continue;
    handled.add(r);
    // Pods, ReplicaSets and Jobs from `kubectl get all` fold into the workload that owns them. Anything else an
    // owner makes (a Deployment an operator's custom resource manages) is drawn: the owner isn't.
    if (ownerWorkload(r)) {
      skip(r.kind, r.name, diagnostic("importDetail.foldedIntoItsOwner"));
      continue;
    }
    const containers = list(own(p.pod, "containers")).filter(isMap);
    const app = str(own(p.labels, "app.kubernetes.io/name")) ?? str(own(p.labels, "app"));
    const cname = (c: unknown) => str(own(c, "name")) ?? "";
    const main =
      containers.find((c) => cname(c) === r.name || (app && cname(c) === app)) ??
      containers.find((c) => !SIDECARS.has(cname(c))) ??
      containers[0];
    const image = str(own(main, "image"))?.slice(0, 512);
    const byImage = imageStencil(image);
    if (typeof byImage === "object") {
      skip(r.kind, r.name, byImage.skip);
      skippedPods.push({ ns: r.ns, labels: p.labels });
      continue;
    }
    const w: Workload = { res: r, key: `w\u0001${at(r.kind, r.ns, r.name)}`, pod: p.pod, labels: p.labels, image };
    workloads.push(w);
    workloadNames.add(r.kind, r.ns, r.name, w);
    for (const [k, v] of entries(p.labels)) {
      const pair = `${nsName(r.ns, k)}=${v}`;
      const bucket = byLabel.get(pair);
      if (bucket) bucket.push(w);
      else byLabel.set(pair, [w]);
    }
  }
  /** The first workload with this name in the namespace, whatever its kind. */
  const workloadNamed = (ns: string, name: string) => workloadNames.named(ns, name);

  // What each workload uses: ConfigMaps and Secrets (for its dependencies) and setting names (for its stencil),
  // from every container. No values here: each container's environment is built on its own, later.
  interface Uses {
    names: Set<string>;
    configs: Map<string, Set<string> | "all">;
    secrets: Map<string, Set<string> | "all">;
  }
  const uses = new Map<Workload, Uses>();
  const addUse = (m: Map<string, Set<string> | "all">, name: string, key?: string) => {
    const cur = m.get(name);
    if (cur === "all") return;
    if (!key) m.set(name, "all");
    else m.set(name, (cur ?? new Set()).add(key));
  };
  /** Setting names hint at a language; a few hundred say as much as thousands. */
  const MAX_NAMES = 500;
  const addNames = (u: Uses, prefix: string, names: Iterable<string>) => {
    for (const n of names) {
      if (u.names.size >= MAX_NAMES) return;
      u.names.add(prefix + n);
    }
  };
  /** Own keys, one at a time (a ConfigMap shared by thousands of workloads isn't copied for each). */
  function* keysIn(...maps: unknown[]) {
    for (const m of maps) if (isMap(m)) for (const k in m) if (Object.hasOwn(m, k)) yield k;
  }
  const configData = (ns: string, name: string) => {
    const data = own(configMaps.get(nsName(ns, name))?.obj, "data");
    return isMap(data) ? data : undefined;
  };
  /** A Secret's key names, listed once per Secret however many containers read it. */
  const secretKeyCache = new Map<string, string[] | undefined>();
  const secretKeys = (ns: string, name: string) => {
    const id = nsName(ns, name);
    if (!secretKeyCache.has(id)) {
      const s = secrets.get(id)?.obj;
      secretKeyCache.set(id, s ? keysOf(own(s, "data"), own(s, "stringData")) : undefined);
    }
    return secretKeyCache.get(id);
  };
  for (const w of workloads) {
    const u: Uses = { names: new Set(), configs: new Map(), secrets: new Map() };
    uses.set(w, u);
    const ns = w.res.ns;
    for (const [init, c] of [
      ...list(own(w.pod, "initContainers")).map((c) => [true, c] as const),
      ...list(own(w.pod, "containers")).map((c) => [false, c] as const),
    ]) {
      for (const ef of list(own(c, "envFrom"))) {
        const prefix = str(own(ef, "prefix")) ?? "";
        const cm = str(own(own(ef, "configMapRef"), "name"));
        if (cm) {
          addUse(u.configs, cm);
          if (!init) addNames(u, prefix, keysIn(configData(ns, cm)));
        }
        const secret = str(own(own(ef, "secretRef"), "name"));
        if (secret) {
          addUse(u.secrets, secret);
          // Names only: a Secret's values are never read.
          const s = secrets.get(nsName(ns, secret))?.obj;
          if (!init) addNames(u, prefix, keysIn(own(s, "data"), own(s, "stringData")));
        }
      }
      for (const e of list(own(c, "env"))) {
        const name = str(own(e, "name"));
        if (!name) continue;
        const from = own(e, "valueFrom");
        const cmRef = own(from, "configMapKeyRef");
        const secretRef = own(from, "secretKeyRef");
        const cm = str(own(cmRef, "name"));
        const secret = str(own(secretRef, "name"));
        if (cm) addUse(u.configs, cm, str(own(cmRef, "key")));
        if (secret) addUse(u.secrets, secret, str(own(secretRef, "key")));
        if (!init) addNames(u, "", [name]);
      }
    }
    for (const v of list(own(w.pod, "volumes"))) {
      const cm = str(own(own(v, "configMap"), "name"));
      const secret = str(own(own(v, "secret"), "secretName"));
      if (cm) addUse(u.configs, cm);
      if (secret) addUse(u.secrets, secret);
      for (const source of list(own(own(v, "projected"), "sources"))) {
        const pcm = str(own(own(source, "configMap"), "name"));
        const ps = str(own(own(source, "secret"), "name"));
        if (pcm) addUse(u.configs, pcm);
        if (ps) addUse(u.secrets, ps);
      }
    }
  }

  for (const w of workloads) {
    const r = w.res;
    const s = spec(r);
    const image = w.image;
    const replicas = num(own(s, "replicas"));
    const schedule = r.kind === "CronJob" ? str(own(s, "schedule"))?.slice(0, 60) : undefined;
    add({
      key: w.key,
      label: label(r.name),
      sublabel: schedule ?? (image ? shortImage(image).slice(0, 80) : r.kind),
      hint: {
        name: label(r.name),
        image,
        env: [...(uses.get(w)?.names ?? [])].slice(0, 500),
        fallback: r.kind === "Pod" ? "k8s.pod" : "k8s.deployment",
      },
      // A CronJob starts work on its schedule: a source, so it sends in Live. A Job runs once.
      ...(r.kind === "CronJob"
        ? { stencil: "generic.scheduler" }
        : r.kind === "Job"
          ? { stencil: "generic.batch-job" }
          : {}),
      group: r.ns,
      context: r.ns,
      // A count the manifest sets, one included (single-point reads it). An unset one stays unset: a base that
      // an overlay or an autoscaler scales leaves it out, so it isn't evidence of one replica.
      ...(replicas && replicas <= 10_000 ? { props: { replicas } } : {}),
    });
  }

  // ------------------------------------------------ Strimzi: the cluster is shown through its topics
  // A Strimzi cluster is its namespace and name, whether or not its `Kafka` manifest was opened: a KafkaTopic's
  // label or a bootstrap host names it. A topic with no cluster label is scoped to its namespace.
  const clusterId = (ns: string, name: string) => `\u0007${nsName(ns, name)}`;
  const clusterOf = (id: string) => {
    const [ns, name] = id.slice(1).split("\u0001");
    return { ns, name };
  };
  /** Clusters the files name: a Kafka manifest, a topic's label. */
  const strimziIds = new Set([...strimzi.values()].map((k) => clusterId(k.ns, k.name)));
  const strimziTopics = resources.filter((r) => r.group === "kafka.strimzi.io" && r.kind === "KafkaTopic");
  const clustersWithTopics = new Set<string>();
  const topicKey = (cluster: string | undefined, name: string) => `\u0004${cluster ?? ""}\u0001${name}`;
  for (const t of strimziTopics) {
    handled.add(t);
    const cluster = str(own(own(meta(t), "labels"), "strimzi.io/cluster"))?.slice(0, 200);
    const id = clusterId(t.ns, cluster ?? "");
    if (cluster) {
      clustersWithTopics.add(id);
      strimziIds.add(id);
    }
    const name = (str(own(spec(t), "topicName")) ?? t.name).slice(0, 249);
    const partitions = num(own(spec(t), "partitions"));
    const key = add({
      key: topicKey(id, name),
      label: label(name),
      hint: { name },
      stencil: "kafka.topic",
      group: t.ns,
      context: t.ns,
      ...(partitions ? { props: { partitions } } : {}),
    });
    if (cluster) links.topicCluster.set(key, id);
  }
  /** The cluster as a node (when something depends on it but names no topic, or it has no topics). */
  const clusterNode = (id: string) => {
    if (!id.startsWith("\u0007")) return components.has(id) ? id : undefined;
    const { ns, name } = clusterOf(id);
    if (!name) return undefined;
    return add({
      key: id,
      label: label(name),
      ...(strimzi.has(nsName(ns, name)) ? {} : { sublabel: NOT_IN_FILES }),
      hint: { name },
      stencil: "kafka.cluster",
      group: ns,
      context: ns,
    });
  };
  for (const k of strimzi.values()) {
    handled.add(k);
    const id = clusterId(k.ns, k.name);
    if (clustersWithTopics.has(id)) skip("Kafka", k.name, diagnostic("importDetail.shownThroughItsTopics"));
    else clusterNode(id);
  }

  // ------------------------------------------------ Services: requests go to the workloads they select
  /** `ns\u0001name` → what the Service reaches: workload keys, its own node, or an outside host. */
  const serviceTargets = new Map<string, string[]>();
  const placeholder = (ns: string, name: string, why: string) => {
    const key = add({
      key: `s\u0001${nsName(ns, name)}`,
      label: label(name),
      sublabel: why,
      hint: { name },
      stencil: "generic.service",
      group: ns,
      context: ns,
    });
    note(
      diagnostic("importDetail.value0AServiceWithValue1In", {
        value0: label(name),
        reason: why === NOT_IN_FILES ? "definition" : "workload",
      }),
    );
    return key;
  };
  const selects = (selector: [string, string][], ns: string, labels: Record<string, unknown>, labelsNs: string) =>
    labelsNs === ns && selector.every(([k, v]) => str(own(labels, k)) === v);
  const externalNode = (host: string) =>
    add({
      key: `\u0003${host}`,
      label: host,
      hint: { name: host },
      stencil: productOf(host) ?? "generic.external-api",
    });
  const services = core("Service");
  for (const svc of services) {
    handled.add(svc);
    const s = spec(svc);
    const type = str(own(s, "type")) ?? "ClusterIP";
    let targets: string[] = [];
    if (type === "ExternalName") {
      const host = (str(own(s, "externalName")) ?? "").toLowerCase().replace(/\.$/, "");
      if (/^[a-z0-9][a-z0-9.-]{0,252}$/.test(host) && isOutsideHost(host) && !inClusterSyntax(host))
        targets = [externalNode(host)];
    } else {
      const selector = entries(own(s, "selector"));
      if (selector.length) {
        const pairs = selector.map(([k, v]) => byLabel.get(`${nsName(svc.ns, k)}=${v}`) ?? []);
        const rarest = pairs.reduce((a, b) => (b.length < a.length ? b : a));
        targets = rarest.filter((w) => selects(selector, svc.ns, w.labels, w.res.ns)).map((w) => w.key);
        if (!targets.length && skippedPods.some((p) => selects(selector, svc.ns, p.labels, p.ns))) {
          serviceTargets.set(nsName(svc.ns, svc.name), []);
          continue;
        }
      }
    }
    if (!targets.length) targets = [placeholder(svc.ns, svc.name, "no workload in these files")];
    serviceTargets.set(nsName(svc.ns, svc.name), targets);
  }
  /** A backend named by an Ingress or a route: the Service's targets, or a node saying it isn't in the files. */
  const backend = (ns: string, name: string) =>
    serviceTargets.get(nsName(ns, name)) ??
    (workloadNamed(ns, name) ? [workloadNamed(ns, name)!.key] : [placeholder(ns, name, NOT_IN_FILES)]);

  // ------------------------------------------------ entry points: Ingress, Gateway API, LoadBalancer Services
  // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
  const users = () => add({ key: "\u0002users", label: "Users", hint: { name: "users" }, stencil: "client.user" });
  const spec_: Evidence = { source: "spec" };
  for (const svc of services)
    if (str(own(spec(svc), "type")) === "LoadBalancer")
      for (const t of serviceTargets.get(nsName(svc.ns, svc.name)) ?? []) links.flow(users(), t, "sync", spec_);

  // networking.k8s.io, or `extensions` in manifests older than Kubernetes 1.22.
  const isIngress = (r: Res) => r.kind === "Ingress" && (r.group === "networking.k8s.io" || r.group === "extensions");
  for (const ing of resources.filter(isIngress)) {
    handled.add(ing);
    const s = spec(ing);
    const cls =
      str(own(s, "ingressClassName")) ?? str(own(own(meta(ing), "annotations"), "kubernetes.io/ingress.class"));
    const rules = list(own(s, "rules"));
    const hosts = [...new Set(rules.map((r) => str(own(r, "host"))).filter((h): h is string => !!h))];
    const key = add({
      key: `i\u0001${nsName(ing.ns, ing.name)}`,
      label: label(ing.name),
      ...(hosts.length
        ? { sublabel: `${hosts[0].slice(0, 60)}${hosts.length > 1 ? ` +${hosts.length - 1}` : ""}` }
        : {}),
      hint: { name: ing.name },
      stencil: gatewayStencil(cls),
      group: ing.ns,
      context: ing.ns,
      idPrefix: "ingress-",
    });
    links.flow(users(), key, "sync", spec_);
    const backends = [
      own(s, "defaultBackend"),
      own(s, "backend"),
      ...rules.flatMap((r) => list(own(own(r, "http"), "paths")).map((p) => own(p, "backend"))),
    ];
    for (const b of backends) {
      const name = str(own(own(b, "service"), "name")) ?? str(own(b, "serviceName"));
      if (name) for (const t of backend(ing.ns, name)) links.flow(key, t, "sync", spec_);
    }
  }

  const gatewayKey = (ns: string, name: string) => `gw\u0001${nsName(ns, name)}`;
  const isGatewayApi = (r: Res) => r.group === "gateway.networking.k8s.io";
  for (const gw of resources.filter((r) => isGatewayApi(r) && r.kind === "Gateway")) {
    handled.add(gw);
    const key = add({
      key: gatewayKey(gw.ns, gw.name),
      label: label(gw.name),
      hint: { name: gw.name },
      stencil: gatewayStencil(str(own(spec(gw), "gatewayClassName"))),
      group: gw.ns,
      context: gw.ns,
      idPrefix: "gateway-",
    });
    links.flow(users(), key, "sync", spec_);
  }
  for (const route of resources.filter((r) => isGatewayApi(r) && /Route$/.test(r.kind))) {
    handled.add(route);
    const s = spec(route);
    const parents = list(own(s, "parentRefs"))
      .filter((p) => (str(own(p, "kind")) ?? "Gateway") === "Gateway")
      .map((p) => {
        const ns = str(own(p, "namespace")) ?? route.ns;
        const name = str(own(p, "name")) ?? "";
        const key = gatewayKey(ns, name);
        if (name && !components.has(key)) {
          add({
            key,
            label: label(name),
            sublabel: NOT_IN_FILES,
            hint: { name },
            stencil: "load-balancer",
            group: ns,
            context: ns,
            idPrefix: "gateway-",
          });
          links.flow(users(), key, "sync", spec_);
        }
        return name ? key : undefined;
      })
      .filter((k): k is string => !!k);
    for (const ref of list(own(s, "rules")).flatMap((r) => list(own(r, "backendRefs")))) {
      const name = str(own(ref, "name"));
      if (!name || (str(own(ref, "kind")) ?? "Service") !== "Service") continue;
      for (const t of backend(str(own(ref, "namespace")) ?? route.ns, name))
        for (const p of parents) links.flow(p, t, "sync", spec_);
    }
  }

  // ------------------------------------------------ hosts: Services, StatefulSet pods, Strimzi bootstrap
  // The DNS syntax is parsed first (k8sHosts.ts); the files only say whether a name reaches something drawn.
  const resolveHost = (host: string, from: string): string[] | undefined =>
    workloadNames.resolve(host, from, serviceTargets);
  /** A Strimzi bootstrap or broker host names its cluster, whether or not its Kafka manifest is here. */
  const strimziOf = (host: string, from: string): string | undefined => {
    for (const h of parseServiceHost(host)) {
      const cluster = strimziCluster(h.service);
      if (cluster) return clusterId(h.namespace ?? from, cluster);
    }
    return undefined;
  };
  const kafkaClusters = [
    ...strimziIds,
    ...workloads.filter((w) => components.stencilOf(w.key) === "kafka.cluster").map((w) => w.key),
  ];
  const isKafka = (cluster: string) =>
    cluster.startsWith("\u0007") || components.stencilOf(cluster) === "kafka.cluster";
  const topicOn = (cluster: string | undefined, name: string) => {
    const key = topicKey(cluster, name);
    if (components.has(key)) return key;
    const group = cluster ? (groupOf(cluster) ?? (isKafka(cluster) ? clusterOf(cluster).ns : undefined)) : undefined;
    return add({
      key,
      label: label(name),
      hint: { name },
      stencil: !cluster || isKafka(cluster) ? "kafka.topic" : "generic.topic",
      ...(group ? { group, context: group } : {}),
    });
  };
  const scopeFor = (ns: string): SettingsScope => ({
    host: (host) => resolveHost(host, ns),
    outside: (host) => {
      const parts = host.split(".");
      const last = parts[parts.length - 1];
      return !inClusterSyntax(host) && !namespaces.has(last) && (parts.length > 2 || TLD.test(last));
    },
    cluster: (hosts) => {
      for (const h of hosts) {
        const id = strimziOf(h, ns) ?? resolveHost(h, ns)?.find((t) => components.has(t));
        if (id) return id;
      }
      return undefined;
    },
    onlyCluster: kafkaClusters.length === 1 ? kafkaClusters[0] : undefined,
    topic: topicOn,
    clusterNode,
  });

  // ------------------------------------------------ KEDA and HPA: who consumes what, and how far it scales
  const scaled = (r: Res, ref: unknown): Workload | undefined => {
    const name = str(own(ref, "name"));
    if (!name) return undefined;
    const kind = str(own(ref, "kind")) ?? "Deployment";
    const w = workloadNames.at(kind, r.ns, name);
    const version = str(own(ref, "apiVersion")) ?? "apps/v1";
    return w && str(own(w.res.obj, "apiVersion")) === version ? w : undefined;
  };
  const claimed = new Map<Workload, ScalingSummary[]>();
  const omittedControllers = new Map<Workload, number>();
  const failure = (w: Workload, reason: string) => {
    const c = components.byKey.get(w.key)!;
    c.props = {
      ...c.props,
      autoscaling: {
        mode: "unsupported",
        provider: "Kubernetes",
        reason,
        ...(claimed.has(w) ? { controllers: claimed.get(w), controllersOmitted: omittedControllers.get(w) ?? 0 } : {}),
      },
    };
    note(
      diagnostic("importDetail.scalingUnsupported", {
        reason: diagnostic("importDetail.scalingReason", { reason: scalingReasonCode(reason) }),
      }),
    );
  };
  const resourceErrors = new Map<Workload, string>();
  for (const w of workloads) {
    try {
      const r = workloadResources(w.pod);
      if (r) {
        const c = components.byKey.get(w.key)!;
        c.props = { ...c.props, resources: r };
      }
    } catch {
      resourceErrors.set(w, "Container resources are unsupported or exceed simulator bounds");
      note(
        diagnostic("importDetail.scalingUnsupported", {
          reason: diagnostic("importDetail.scalingReason", { reason: "container" }),
        }),
      );
    }
  }
  const attach = (w: Workload, r: Res, create: () => AutoscalingConfig) => {
    const previous = claimed.get(w),
      summaries = previous ?? [];
    const hpa = r.kind === "HorizontalPodAutoscaler";
    const summaryCount = (key: string, fallback?: number) => {
      return own(spec(r), key) === undefined ? fallback : num(own(spec(r), key));
    };
    const minimum = summaryCount(hpa ? "minReplicas" : "minReplicaCount", hpa ? 1 : 0),
      maximum = summaryCount(hpa ? "maxReplicas" : "maxReplicaCount", hpa ? undefined : 100);
    if (summaries.length < 16)
      summaries.push({
        kind: hpa ? "HPA" : r.kind === "ScaledJob" ? "ScaledJob" : "ScaledObject",
        ...(minimum !== undefined ? { minReplicas: minimum } : {}),
        ...(maximum !== undefined ? { maxReplicas: maximum } : {}),
      });
    else omittedControllers.set(w, (omittedControllers.get(w) ?? 0) + 1);
    claimed.set(w, summaries);
    if (previous) {
      failure(w, "Conflicting controllers target this workload; choose one policy");
      return;
    }
    try {
      const annotations = own(own(r.obj, "metadata"), "annotations");
      if (isMap(annotations) && Object.keys(annotations).some((key) => key.startsWith("autoscaling.keda.sh/")))
        throw new Error("Unsupported KEDA scaling annotation fields");
      if (resourceErrors.has(w)) throw new Error(resourceErrors.get(w));
      if (list(own(w.pod, "containers")).length !== 1 || list(own(w.pod, "initContainers")).length)
        throw new Error("Multi-container resource accounting is unsupported");
      const autoscaling = create(),
        c = components.byKey.get(w.key)!;
      const resources = c.props?.resources ?? {
        ...resourceLesson(),
        preset: "kubernetes-unmeasured",
        modelRevision: "a2" as const,
        cpuMsPerMessage: 0,
        baselineMemoryMiB: 0,
        memoryMiBPerMessage: 0,
        cpuRequestMilli: undefined,
        cpuLimitMilli: undefined,
        memoryRequestMiB: undefined,
        memoryLimitMiB: undefined,
      };
      c.props = { ...c.props, resources, autoscaling };
      if (autoscaling.mode === "on")
        note(
          diagnostic(
            autoscaling.controller.kind === "keda"
              ? "importDetail.value0ScalesFromValue1ToValue2"
              : "importDetail.value0ScalesFromValue1ToValue2More",
            {
              value0: w.res.name,
              value1: autoscaling.controller.minReplicas,
              value2: autoscaling.controller.maxReplicas,
            },
          ),
        );
      note(
        diagnostic("importDetail.scalingMapped", {
          kind:
            autoscaling.mode === "on" ? (autoscaling.controller.kind === "keda" ? "KEDA 2.18" : "HPA") : "Kubernetes",
        }),
      );
    } catch (error) {
      failure(w, error instanceof Error ? error.message : "Unsupported scaling settings");
    }
  };
  const brokerHosts = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((h) =>
        h
          .trim()
          .replace(/^[a-z]+:\/\//i, "")
          .replace(/:\d{1,5}$/, "")
          .toLowerCase(),
      )
      .filter((h) => /^[a-z0-9][a-z0-9.-]{0,252}$/.test(h));
  for (const so of resources.filter(
    (r) => r.group === "keda.sh" && (r.kind === "ScaledObject" || r.kind === "ScaledJob"),
  )) {
    handled.add(so);
    const s = spec(so);
    const job = so.kind === "ScaledJob";
    const w = job ? workloadNames.at(so.kind, so.ns, so.name) : scaled(so, own(s, "scaleTargetRef"));
    if (!w) {
      skip(so.kind, so.name, diagnostic("importDetail.scalesAWorkloadThatIsntIn"));
      continue;
    }
    const triggers: KedaTrigger[] = [];
    let triggerProblem: string | undefined;
    const bind = (input: unknown, node: string, group?: string) => {
      try {
        triggers.push(importTrigger(input, { node, ...(group ? { group } : {}) }));
      } catch (error) {
        triggerProblem = error instanceof Error ? error.message : "Unsupported KEDA trigger";
      }
    };
    const inputs = list(own(s, "triggers"));
    if (!inputs.length || inputs.length > 16) triggerProblem = "KEDA requires one to sixteen supported triggers";
    const scope = scopeFor(so.ns);
    const evidence: Evidence = { source: "spec", note: "KEDA trigger" };
    for (const t of inputs.slice(0, 16)) {
      const type = (str(own(t, "type")) ?? "").toLowerCase().slice(0, 40);
      const md = own(t, "metadata");
      if (type === "kafka" || type === "apache-kafka") {
        const cluster = scope.cluster(brokerHosts(str(own(md, "bootstrapServers")) ?? str(own(md, "brokerList"))));
        const group = str(own(md, "consumerGroup"))?.slice(0, 249);
        const topics = (str(own(md, "topic")) ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter((x) => /^[\w.-]{1,249}$/.test(x));
        for (const name of topics) {
          const localCluster =
            cluster ?? (components.has(topicKey(clusterId(so.ns, ""), name)) ? clusterId(so.ns, "") : undefined);
          const topic = topicOn(localCluster, name);
          if (cluster) links.topicCluster.set(topic, cluster);
          links.flow(topic, w.key, "async", evidence, group ? { group } : undefined);
          bind(t, topic, group);
          if (topics.length !== 1 || components.byKey.get(topic)?.props?.partitions === undefined)
            triggerProblem = "Kafka needs one known topic with declared partitions and local offset history";
        }
        if (!topics.length && cluster) {
          const node = clusterNode(cluster);
          if (node) links.dep(w.key, node, "depends", { ...evidence, note: "couldn't tell what it reads" });
        }
      } else if (type === "rabbitmq") {
        const queue = str(own(md, "queueName"));
        if (!queue || !/^[\w.:-]{1,255}$/.test(queue)) continue;
        // The host is often a URL with a password: only its host name is looked at (userinfo is cut first).
        const host = parseUrl(str(own(md, "host")) ?? "")?.hosts[0];
        const broker = host ? resolveHost(host, so.ns)?.find((k) => components.has(k)) : undefined;
        const group = broker ? groupOf(broker) : undefined;
        const key = add({
          key: `\u0004rabbitmq\u0001${broker ?? ""}\u0001${queue}`,
          label: label(queue),
          hint: { name: queue },
          stencil: "rabbitmq.queue",
          ...(group ? { group, context: group } : {}),
        });
        links.flow(key, w.key, "async", evidence);
        bind(t, key);
      } else if (type === "aws-sqs-queue") {
        const url = (str(own(md, "queueURL")) ?? "").replace(/[?#].*$/s, "");
        const name = str(own(md, "queueName")) ?? url.slice(url.lastIndexOf("/") + 1);
        if (!/^[\w-]{1,80}(\.fifo)?$/.test(name)) continue;
        const region = (str(own(md, "awsRegion")) ?? "").slice(0, 30);
        const key = add({
          key: `\u0004sqs\u0001${region}\u0001${name}`,
          label: name,
          hint: { name },
          stencil: "aws.sqs",
        });
        links.flow(key, w.key, "async", evidence);
        bind(t, key);
      } else if (type === "azure-servicebus") {
        const queue = str(own(md, "queueName"));
        const topic = str(own(md, "topicName"));
        const name = queue ?? topic;
        if (!name || !/^[\w./~-]{1,260}$/.test(name)) continue;
        const sbNamespace = (str(own(md, "namespace")) ?? "").slice(0, 60);
        const subscription = str(own(md, "subscriptionName"))?.slice(0, 50);
        const key = add({
          key: `\u0004servicebus\u0001${sbNamespace}\u0001${name}`,
          label: label(name),
          hint: { name },
          stencil: queue ? "azure.service-bus.queue" : "azure.service-bus.topic",
        });
        links.flow(key, w.key, "async", evidence, !queue && subscription ? { group: subscription } : undefined);
        bind(t, key, !queue ? subscription : undefined);
      } else if (type) {
        triggerProblem = "Unsupported KEDA trigger";
        skip(
          so.kind,
          so.name,
          diagnostic("importDetail.value0TriggerScalingOnly", { value0: type.replace(/[^\w-]/g, "") }),
        );
      }
    }
    attach(w, so, () => {
      if (job) throw new Error("Job execution is not simulated");
      if (str(own(so.obj, "apiVersion")) !== "keda.sh/v1alpha1")
        throw new Error("Unsupported KEDA API version (profile is 2.18)");
      if (triggerProblem || triggers.length !== inputs.length)
        throw new Error(triggerProblem ?? "A KEDA trigger has no exact local broker binding");
      const annotations = own(meta(so), "annotations");
      if (
        isMap(annotations) &&
        Object.keys(annotations).some((k) => k.startsWith("autoscaling.keda.sh/") || k.includes("hpa-ownership"))
      )
        throw new Error("KEDA pause and ownership-transfer annotations require a deliberate policy choice");
      return importKeda(s, num(own(spec(w.res), "replicas")), triggers);
    });
  }
  const scaledObjects = new Map(
    resources.filter((r) => r.group === "keda.sh" && r.kind === "ScaledObject").map((r) => [nsName(r.ns, r.name), r]),
  );
  for (const hpa of resources.filter((r) => r.kind === "HorizontalPodAutoscaler")) {
    handled.add(hpa);
    const s = spec(hpa);
    const w = scaled(hpa, own(s, "scaleTargetRef"));
    if (!w) {
      skip(hpa.kind, hpa.name, diagnostic("importDetail.scalesAWorkloadThatIsntIn"));
      continue;
    }
    const owners = list(own(meta(hpa), "ownerReferences"));
    const owner = owners.find(
      (o) =>
        own(o, "kind") === "ScaledObject" &&
        own(o, "apiVersion") === "keda.sh/v1alpha1" &&
        own(o, "controller") !== false,
    );
    if (owner) {
      const so = scaledObjects.get(nsName(hpa.ns, str(own(owner, "name")) ?? ""));
      if (
        so &&
        scaled(so, own(spec(so), "scaleTargetRef")) === w &&
        (own(owner, "uid") === undefined || own(owner, "uid") === own(meta(so), "uid"))
      )
        continue;
      attach(w, hpa, () => {
        throw new Error("Generated HPA owner is missing or targets a different workload");
      });
      continue;
    }
    attach(w, hpa, () => importHpa(s, num(own(spec(w.res), "replicas")), str(own(hpa.obj, "apiVersion")) ?? ""));
  }

  // ------------------------------------------------ Kafka Connect: depends on the cluster it names
  for (const kc of resources.filter((r) => r.group === "kafka.strimzi.io" && r.kind === "KafkaConnect")) {
    handled.add(kc);
    const key = add({
      key: `kc\u0001${nsName(kc.ns, kc.name)}`,
      label: label(kc.name),
      hint: { name: kc.name },
      stencil: "kafka.connect",
      group: kc.ns,
      context: kc.ns,
    });
    const cluster = scopeFor(kc.ns).cluster(brokerHosts(str(own(spec(kc), "bootstrapServers"))));
    const node = cluster && clusterNode(cluster);
    if (node) links.dep(key, node, "depends", spec_);
  }

  // ------------------------------------------------ per workload: config, secrets, identity, settings
  const usedConfigs = new Set<string>();
  const usedSecrets = new Set<string>();
  const usedAccounts = new Set<string>();
  const settingsOf = (keys: Iterable<string>, secret: boolean) => {
    const out = [...new Set(keys)].slice(0, 200).map((key) => (secret ? { key, secret: true } : { key }));
    return out.length ? { settings: out } : undefined;
  };
  for (const w of workloads) {
    const u = uses.get(w)!;
    const ns = w.res.ns;
    for (const [name, keys] of u.configs) {
      const cm = configMaps.get(nsName(ns, name));
      if (cm) usedConfigs.add(nsName(ns, name));
      const node = add({
        key: `c\u0001${nsName(ns, name)}`,
        label: label(name),
        ...(cm ? {} : { sublabel: NOT_IN_FILES }),
        hint: { name },
        stencil: "k8s.configmap",
        group: ns,
        context: ns,
        idPrefix: "configmap-",
      });
      const all = keys === "all" ? keysOf(own(cm?.obj, "data"), own(cm?.obj, "binaryData")) : [...keys];
      links.dep(w.key, node, "config", spec_, settingsOf(all, false));
    }
    for (const [name, keys] of u.secrets) {
      const s = secrets.get(nsName(ns, name));
      const type = str(own(s?.obj, "type")) ?? "";
      if (Object.hasOwn(SECRET_TYPES, type) || (!s && /(^|[-.])tls$/.test(name))) continue;
      if (s) usedSecrets.add(nsName(ns, name));
      const node = add({
        key: `x\u0001${nsName(ns, name)}`,
        label: label(name),
        ...(s ? {} : { sublabel: NOT_IN_FILES }),
        hint: { name },
        stencil: "k8s.secret",
        group: ns,
        context: ns,
        idPrefix: "secret-",
      });
      // Key names only; `data` and `stringData` values are never read.
      const all = keys === "all" ? keysOf(own(s?.obj, "data"), own(s?.obj, "stringData")) : [...keys];
      links.dep(w.key, node, "secret", spec_, settingsOf(all, true));
    }
    const account =
      str(own(w.pod, "serviceAccountName")) ?? str(own(w.pod, "serviceAccount")) ?? (accounts.size ? "default" : "");
    const sa = account ? accounts.get(nsName(ns, account)) : undefined;
    if (sa) {
      usedAccounts.add(nsName(ns, sa.name));
      const annotations = own(meta(sa), "annotations");
      for (const [annotation, stencil, valid, name] of IDENTITIES) {
        const value = str(own(annotations, annotation))?.trim();
        if (!value || value.length > 600 || !valid.test(value)) continue;
        const node = add({
          key: `\u0006${annotation}\u0001${value}`,
          label: label(name(value, sa.name)),
          hint: { name: sa.name },
          stencil,
          idPrefix: "identity-",
        });
        links.dep(w.key, node, "identity", spec_);
      }
    }
  }
  // Connections from settings: each container's environment on its own (two containers may give one name two
  // values), built, read and released in turn. The workload's connections are the union of its containers'.
  const budget = newEnvBudget();
  for (const w of workloads) {
    const ns = w.res.ns;
    const sources = {
      configMap: (name: string) => configData(ns, name),
      secretKeys: (name: string) => secretKeys(ns, name),
    };
    const scope = scopeFor(ns);
    for (const c of list(own(w.pod, "containers"))) {
      const env = containerEnv(c, sources, budget);
      if (env) linkSettings(components, links, w.key, knownSettings(env), scope);
    }
  }
  if (budget.exhausted)
    note(diagnostic("importDetail.settingsPastTheFirstValue0Number", { value0: ENV_LIMITS.maxSettings }));

  // ------------------------------------------------ Strimzi KafkaUser ACLs: who may produce and consume
  // The User Operator writes a KafkaUser's credentials to a Secret named after it (with the cluster's
  // `userOperator.secretPrefix`) in its namespace, and a pod can only use Secrets in its own namespace: a workload that
  // mounts or reads that Secret is that user. Its literal topic ACLs are flows (Write: it produces; Read: it
  // consumes, in the group its literal group ACL names), unless a deny ACL forbids them: Kafka applies a matching deny
  // first, so a denied flow is never drawn. ACLs for some hosts only, wildcards and prefixes, and users no workload
  // here uses, are listed. Only the Secret's name is looked at, never its values.
  const bySecret = new SecretUsers();
  for (const w of workloads) for (const name of uses.get(w)?.secrets.keys() ?? []) bySecret.add(w.res.ns, name, w.key);
  type Op = "read" | "write";
  interface Acl {
    deny: boolean;
    type: string;
    name: string;
    pattern: string;
    ops: Set<string>;
    anyHost: boolean;
  }
  const aclOf = (acl: unknown): Acl | undefined => {
    const resource = own(acl, "resource");
    const name = str(own(resource, "name"))?.slice(0, 249);
    if (!name) return undefined;
    const host = str(own(acl, "host"));
    return {
      deny: (str(own(acl, "type")) ?? "allow").toLowerCase() === "deny",
      type: (str(own(resource, "type")) ?? "").toLowerCase(),
      name,
      pattern: (str(own(resource, "patternType")) ?? "literal").toLowerCase(),
      ops: new Set(
        [...list(own(acl, "operations")), own(acl, "operation")]
          .map((o) => (str(o) ?? "").toLowerCase())
          .filter(Boolean),
      ),
      anyHost: host === undefined || host.trim() === "*",
    };
  };
  /** Does this deny cover `op` on the resource `type` named `name`? A deny for any host counts everywhere. */
  const forbids = (d: Acl, type: string, name: string, op: Op) =>
    d.type === type &&
    (d.ops.has("all") || d.ops.has(op)) &&
    (d.name === "*" || (d.pattern === "prefix" ? name.startsWith(d.name) : d.name === name));
  const plain = (name: string) => name !== "*" && /^[\w.-]{1,249}$/.test(name);
  let aclFlows = false;
  for (const u of resources.filter((r) => r.group === "kafka.strimzi.io" && r.kind === "KafkaUser")) {
    const authz = own(spec(u), "authorization");
    const acls = list(own(authz, "acls"))
      .slice(0, 500)
      .map(aclOf)
      .filter((a): a is Acl => !!a);
    if (str(own(authz, "type")) !== "simple" || !acls.length) continue;
    handled.add(u);
    const cluster = str(own(own(meta(u), "labels"), "strimzi.io/cluster"))?.slice(0, 200);
    const kafka = cluster ? strimzi.get(nsName(u.ns, cluster)) : undefined;
    const prefix =
      (kafka && str(own(own(own(spec(kafka), "entityOperator"), "userOperator"), "secretPrefix"))?.slice(0, 100)) || "";
    const users = bySecret.get(u.ns, `${prefix}${u.name}`);
    if (!users.length) {
      skip(u.kind, u.name, diagnostic("importDetail.itsACLsArentDrawnNoWorkload"));
      continue;
    }
    const denies = acls.filter((a) => a.deny);
    const allowed = (type: string, name: string, op: Op) => !denies.some((d) => forbids(d, type, name, op));
    const writes = new Set<string>();
    const reads = new Set<string>();
    const groups = new Set<string>();
    const wide: ImportText[] = [];
    for (const a of acls) {
      if (a.deny) continue;
      const all = a.ops.has("all");
      if (a.type === "group") {
        if (a.anyHost && a.pattern === "literal" && plain(a.name) && (all || a.ops.has("read")))
          if (allowed("group", a.name, "read")) groups.add(a.name);
        continue;
      }
      if (a.type !== "topic") continue;
      const read = all || a.ops.has("read");
      const write = all || a.ops.has("write");
      if (!read && !write) continue;
      const action = read && write ? "both" : read ? "read" : "write";
      if (a.pattern !== "literal" || !plain(a.name)) {
        wide.push(
          diagnostic("importReport.aclWide", {
            action,
            scope: a.name === "*" ? "all" : "prefix",
            name: a.name.replace(/[^\w.-]/g, ""),
          }),
        );
        continue;
      }
      // Host constraints do not reveal which hosts these workloads run on.
      if (!a.anyHost) {
        wide.push(diagnostic("importReport.aclHosts", { action, name: a.name }));
        continue;
      }
      if (write && allowed("topic", a.name, "write")) writes.add(a.name);
      if (read && allowed("topic", a.name, "read")) reads.add(a.name);
    }
    const id = clusterId(u.ns, cluster ?? "");
    const group = groups.size === 1 ? [...groups][0] : undefined;
    const evidence = (note: ImportText): Evidence => ({ source: "resource", name: `KafkaUser ${u.name}`, note });
    for (const name of writes) {
      const topic = topicOn(id, name);
      for (const w of users) links.flowOrEnrich(w, topic, "async", evidence("writes"));
    }
    for (const name of reads) {
      const topic = topicOn(id, name);
      for (const w of users) links.flowOrEnrich(topic, w, "async", evidence("reads"), group);
    }
    if (writes.size || reads.size) aclFlows = true;
    if (wide.length)
      note(
        diagnostic("importDetail.value0KafkaUserMayValue1value2NotDrawn", {
          value0: label(u.name),
          value1: { list: wide.slice(0, 3), english: "comma" },
          value2: wide.length > 3 ? "…" : "",
        }),
      );
    skip(u.kind, u.name, diagnostic("importDetail.shownAsItsWorkloadsFlows"));
  }
  if (aclFlows) g.connectionsTitle = diagnostic("importReport.kafkaConnections");

  // ------------------------------------------------ what isn't drawn, and why
  for (const r of resources) {
    if (handled.has(r)) continue;
    const id = nsName(r.ns, r.name);
    if (r.group === "" && r.kind === "Namespace") continue;
    if (r.group === "" && r.kind === "ConfigMap") {
      if (!usedConfigs.has(id)) skip(r.kind, r.name, diagnostic("importDetail.noWorkloadUsesIt"));
    } else if (r.group === "" && r.kind === "Secret") {
      const type = str(own(r.obj, "type")) ?? "";
      if (!usedSecrets.has(id))
        skip(
          r.kind,
          r.name,
          Object.hasOwn(SECRET_TYPES, type) ? SECRET_TYPES[type] : diagnostic("importDetail.noWorkloadUsesIt"),
        );
    } else if (r.group === "" && r.kind === "ServiceAccount") {
      if (!usedAccounts.has(id)) skip(r.kind, r.name, diagnostic("importDetail.notAComponent"));
    } else if (r.group === "kafka.strimzi.io" && PART_OF_KAFKA.has(r.kind))
      skip(r.kind, r.name, diagnostic("importDetail.partOfKafka"));
    else if (NOT_A_COMPONENT.has(r.kind)) skip(r.kind, r.name, diagnostic("importDetail.notAComponent"));
    else skip(r.kind, r.name, diagnostic("importDetail.unknownKindValue0", { value0: r.group || "core" }));
  }
  for (const { kind, reason, names } of skipped.values())
    g.notDrawn.push({
      name:
        names.length === 1
          ? `${kind} ${names[0]}`
          : diagnostic("importReport.namedCount", { name: kind, count: names.length }),
      reason,
    });
  if (!g.components.length) throw new ImportError(tr("importDetail.theresNothingToDrawTheseFiles"));
  g.links = links.list();

  // ------------------------------------------------ namespaces are boundaries; the title names them
  const count = new Map<string, number>();
  for (const c of g.components) if (c.group) count.set(c.group, (count.get(c.group) ?? 0) + 1);
  const used = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  if (explicit.size) g.groups = used.map((ns) => ({ key: ns, label: label(ns), tone: "k8s" }));
  else for (const c of g.components) delete c.group;
  const first = files[0]?.name.replace(/^.*[\\/]/, "").replace(/\.(ya?ml|json)$/i, "") || "Kubernetes";
  g.title = !explicit.size
    ? files.length === 1
      ? label(first)
      : "Kubernetes manifests"
    : used.length === 1
      ? label(used[0])
      : used.length === 2
        ? label(`${used[0]} and ${used[1]}`)
        : label(`${used[0]} and ${used.length - 1} more namespaces`);
  return g;
}
