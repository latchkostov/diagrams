import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { relationOf } from "../../model/relations";
import { estimateCardSize } from "../../canvas/nodes/size";
import { detectFormat, importFiles, importText, type ImportOutcome } from "../formats";
import { sniffInfra } from "../sniff";
import type { ImportReport } from "./graph";
import { importKubernetes } from "./pipeline";
import { HELM_TEMPLATE, MAX_RESOURCES, readKubernetes } from "./kubernetes";
import { parseServiceHost } from "./k8sHosts";
import { ENV_LIMITS, expandVars, OPAQUE } from "./k8sSettings";
import { MAX_VALUE } from "./settings";
import { TOO_MANY_ALIASES } from "./yaml";
import { perfBudget } from "../../test/perfBudget";

// Kubernetes import against the self-written fixture set (tests/fixtures/imports/k8s), as
// docs/research/imports.md § Mapping: Kubernetes describes it, plus KEDA, Strimzi, entry points, identities,
// what isn't drawn, and hostile input.

const DIR = "tests/fixtures/imports/k8s";
const FIXTURES = readdirSync(DIR)
  .sort()
  .map((name) => ({ name, text: readFileSync(`${DIR}/${name}`, "utf8") }));

function ok(outcome: ImportOutcome): { diagram: DiagramFile; report: ImportReport } {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  if (!outcome.report) throw new Error("no report");
  return { diagram: outcome.diagram, report: outcome.report };
}
const fixture = () => ok(importKubernetes(FIXTURES));
const k8s = (text: string, name = "manifests.yaml") => ok(importKubernetes([{ name, text }]));
const node = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id);
const edge = (d: DiagramFile, from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to);
const relationBetween = (d: DiagramFile, from: string, to: string) => {
  const e = edge(d, from, to);
  return e && (relationOf(e) === "flow" ? (e.kind === "sync" ? "request" : "message") : relationOf(e));
};
const boundaryOf = (d: DiagramFile, id: string) => d.groups?.find((g) => g.id === node(d, id)?.group)?.label;

/** A Deployment with one container, for the smaller cases. */
const deployment = (name: string, image: string, extra = "", ns = "") => `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
${ns ? `  namespace: ${ns}\n` : ""}spec:
  selector: { matchLabels: { app: ${name} } }
  template:
    metadata: { labels: { app: ${name} } }
    spec:
${extra}      containers:
        - name: ${name}
          image: ${image}
`;

describe("Kubernetes import: the fixture set", () => {
  it("is recognised, and the five files import as one diagram", async () => {
    for (const f of FIXTURES) expect(detectFormat(f.text, f.name), f.name).toBe("kubernetes");
    const outcome = await importFiles(FIXTURES);
    expect(outcome.ok).toBe(true);
    if (outcome.ok === true) expect(outcome.format).toBe("kubernetes");
  });

  it("draws the workloads, the entry, ConfigMap, Secrets, identity and topics, in two namespace boundaries", () => {
    const { diagram } = fixture();
    expect(diagram.title).toBe("shop and kafka");
    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(
      [
        "orders-api",
        "payments-worker",
        "settlement-report",
        "postgres",
        "redis",
        "storefront",
        "ingress-shop",
        "users",
        "topic-orders.placed.v1",
        "topic-payments.completed.v1",
        "configmap-orders-api-config",
        "secret-orders-db",
        "secret-payment-provider",
        "identity-orders-api",
      ].sort(),
    );
    expect(diagram.groups?.map((g) => [g.id, g.label, g.tone])).toEqual([
      ["boundary-shop", "shop", "k8s"],
      ["boundary-kafka", "kafka", "k8s"],
    ]);
    for (const id of [
      "orders-api",
      "payments-worker",
      "settlement-report",
      "postgres",
      "redis",
      "storefront",
      "ingress-shop",
      "configmap-orders-api-config",
      "secret-orders-db",
      "secret-payment-provider",
    ])
      expect(boundaryOf(diagram, id), id).toBe("shop");
    for (const id of ["topic-orders.placed.v1", "topic-payments.completed.v1"])
      expect(boundaryOf(diagram, id), id).toBe("kafka");
    // Users and the identity stay outside the namespaces.
    for (const id of ["users", "identity-orders-api"]) expect(node(diagram, id)?.group, id).toBeUndefined();

    const n = (id: string) => node(diagram, id)!;
    expect(n("postgres").stencil).toBe("postgres");
    expect(n("redis").stencil).toBe("redis.cache");
    expect(n("orders-api")).toMatchObject({ stencil: "generic.service", sublabel: "orders-api:2.3.0" });
    expect(n("orders-api").props).toEqual({ replicas: 3 });
    expect(n("settlement-report")).toMatchObject({ stencil: "generic.scheduler", sublabel: "0 2 * * *" });
    expect(n("storefront")).toMatchObject({ stencil: "generic.service", sublabel: "no workload in these files" });
    expect(n("ingress-shop")).toMatchObject({ stencil: "nginx", label: "shop", sublabel: "shop.example.com" });
    expect(n("users").stencil).toBe("client.user");
    expect(n("configmap-orders-api-config").stencil).toBe("k8s.configmap");
    expect(n("secret-orders-db")).toMatchObject({ stencil: "k8s.secret" });
    expect(n("secret-orders-db").sublabel).toBeUndefined();
    expect(n("secret-payment-provider")).toMatchObject({ stencil: "k8s.secret", sublabel: "not in these files" });
    expect(n("identity-orders-api")).toMatchObject({ stencil: "azure.managed-identity", label: "orders-api" });
    expect(n("topic-orders.placed.v1")).toMatchObject({ stencil: "kafka.topic", props: { partitions: 12 } });
    expect(n("topic-payments.completed.v1")).toMatchObject({ stencil: "kafka.topic", props: { partitions: 6 } });
  });

  it("connects the entry, the requests from settings, the KEDA consumer, config, secrets and identity", () => {
    const { diagram: d } = fixture();
    expect(d.edges).toHaveLength(13);
    expect(relationBetween(d, "users", "ingress-shop")).toBe("request");
    expect(relationBetween(d, "ingress-shop", "orders-api")).toBe("request");
    expect(relationBetween(d, "ingress-shop", "storefront")).toBe("request");
    // DATABASE_HOST inline, REDIS_URL from the ConfigMap (its values are read like inline ones).
    expect(relationBetween(d, "orders-api", "postgres")).toBe("request");
    expect(relationBetween(d, "orders-api", "redis")).toBe("request");
    expect(relationBetween(d, "settlement-report", "postgres")).toBe("request");
    // KEDA's Kafka trigger: the topic → its consumer, with the group.
    expect(relationBetween(d, "topic-orders.placed.v1", "payments-worker")).toBe("message");
    expect(edge(d, "topic-orders.placed.v1", "payments-worker")?.props).toEqual({ group: "payments" });
    expect(relationBetween(d, "payments-worker", "topic-payments.completed.v1")).toBe("message");
    expect(relationBetween(d, "orders-api", "topic-orders.placed.v1")).toBe("message");
    // Config with the ConfigMap's key names; Secrets with the key names they use, marked secret.
    expect(relationBetween(d, "orders-api", "configmap-orders-api-config")).toBe("config");
    expect(edge(d, "orders-api", "configmap-orders-api-config")?.props?.settings).toEqual([
      { key: "KAFKA_BOOTSTRAP_SERVERS" },
      { key: "ORDERS_TOPIC" },
      { key: "REDIS_URL" },
      { key: "FEATURE_SPLIT_SHIPMENTS" },
    ]);
    expect(relationBetween(d, "orders-api", "secret-orders-db")).toBe("secret");
    expect(edge(d, "orders-api", "secret-orders-db")?.props?.settings).toEqual([{ key: "DATABASE_URL", secret: true }]);
    expect(relationBetween(d, "payments-worker", "secret-payment-provider")).toBe("secret");
    expect(relationBetween(d, "orders-api", "identity-orders-api")).toBe("identity");
    // Brokers named, but topics too: no extra Depends on the cluster.
    expect(d.edges.filter((e) => e.relation === "depends")).toEqual([]);
  });

  it("reports the settings it read, what it didn't draw, the Service with no workload and the KEDA range", () => {
    const { report } = fixture();
    expect(report.summary).toBe("Imported “shop and kafka” from Kubernetes: 14 nodes, 13 connections.");
    expect(report.format).toBe("Kubernetes");
    expect(report.boundaries).toBe(2);
    expect(report.guesses).toEqual([]);
    expect(report.inferred.map((c) => `${c.from} → ${c.to} ${c.evidence}${c.guess ? " (guess)" : ""}`)).toEqual([
      // Two namespaces: each row says where its nodes live.
      "orders-api (shop) → redis (shop) REDIS_URL",
      "orders-api (shop) → postgres (shop) DATABASE_HOST",
      "orders-api (shop) → orders.placed.v1 (kafka) ORDERS_TOPIC (guess)",
      "payments-worker (shop) → payments.completed.v1 (kafka) OUTPUT_TOPIC",
      "settlement-report (shop) → postgres (shop) DATABASE_HOST",
    ]);
    expect(report.notDrawn).toEqual([
      { name: "Kafka shop-kafka", reason: "shown through its topics" },
      { name: "ServiceMonitor orders-api", reason: "unknown kind (monitoring.coreos.com)" },
    ]);
    expect(report.notes).toEqual([
      "storefront: a Service with no workload in these files",
      "payments-worker scales from 1 to 12 replicas (KEDA)",
    ]);
    expect(report.unread).toEqual([]);
  });

  it("lays out without overlaps, every member inside its boundary", () => {
    const { diagram: d } = fixture();
    const boxes = d.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) }));
    for (const a of boxes)
      for (const b of boxes)
        if (a.id < b.id)
          expect(
            a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
            `${a.id} overlaps ${b.id}`,
          ).toBe(true);
    for (const n of d.nodes.filter((x) => x.group)) {
      const g = d.groups!.find((x) => x.id === n.group)!;
      const size = estimateCardSize(n.label, n.sublabel);
      expect(n.x >= g.x && n.y >= g.y, n.id).toBe(true);
      expect(n.x + size.width <= g.x + g.width && n.y + size.height <= g.y + g.height, n.id).toBe(true);
    }
  });

  it("never fetches anything", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await importFiles(FIXTURES);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});

describe("Kubernetes import: Secret values never leave the file", () => {
  it("no Secret data, stringData, password or URL userinfo reaches the diagram or the report", () => {
    const leaky = `apiVersion: v1
kind: Secret
metadata: { name: app-secrets, namespace: shop }
type: Opaque
data:
  DB_PASSWORD: aHVudGVyMi1rOHMtcGFzcw==
  REDIS_URL: cmVkaXM6Ly86c2VjcmV0QHJlZGlzOjYzNzk=
stringData:
  API_TOKEN: sk_live_k8s_abcdefghijklmnop
  DATABASE_URL: postgres://admin:stringdata-pass@postgres.shop.svc:5432/app
---
apiVersion: v1
kind: ConfigMap
metadata: { name: app-config, namespace: shop }
data:
  DATABASE_URL: postgres://admin:configmap-pass@postgres.shop.svc:5432/app?sslmode=require
  PAYMENTS_URL: https://user:url-token@api.payments.example.com/v1
${deployment("api", "example/api:1.0", "      serviceAccountName: api\n", "shop").replace(
  "          image: example/api:1.0\n",
  `          image: example/api:1.0
          envFrom:
            - secretRef: { name: app-secrets }
            - configMapRef: { name: app-config }
          env:
            - { name: INLINE_URL, value: "redis://:inline-pass@redis.shop.svc:6379" }
`,
)}${deployment("postgres", "postgres:16", "", "shop")}${deployment("redis", "redis:7", "", "shop")}
---
apiVersion: v1
kind: Service
metadata: { name: postgres, namespace: shop }
spec: { selector: { app: postgres } }
---
apiVersion: v1
kind: Service
metadata: { name: redis, namespace: shop }
spec: { selector: { app: redis } }
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: api, namespace: shop }
spec:
  scaleTargetRef: { name: api }
  triggers:
    - type: rabbitmq
      metadata: { host: "amqp://guest:rabbit-pass@rabbitmq.shop:5672/vhost", queueName: jobs }
    - type: aws-sqs-queue
      metadata: { queueURL: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders?X-Amz-Signature=sig-secret", awsRegion: eu-west-1 }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: shop
  annotations: { eks.amazonaws.com/role-arn: "arn:aws:iam::123456789012:role/api-role" }
`;
    for (const files of [FIXTURES, [{ name: "leaky.yaml", text: leaky }]]) {
      const { diagram, report } = ok(importKubernetes(files));
      const out = JSON.stringify([diagram, report]);
      for (const secret of [
        // The fixture's Secret value (base64 of "placeholder"), and the leaky file's.
        "cGxhY2Vob2xkZXI",
        "placeholder",
        "aHVudGVy",
        "hunter2",
        "cmVkaXM6",
        "sk_live",
        "stringdata-pass",
        "configmap-pass",
        "url-token",
        "inline-pass",
        "rabbit-pass",
        "guest",
        "sig-secret",
        "sslmode",
        "123456789012",
        "00000000-0000",
        "postgres://",
        "redis://",
        "amqp://",
        "5432",
        "6379",
        "9092",
        "/health",
      ])
        expect(out, secret).not.toContain(secret);
    }
    // What does reach the diagram: names. The Secret's key names, marked secret; the queues; the role's name.
    const { diagram } = k8s(leaky);
    expect(edge(diagram, "api", "secret-app-secrets")?.props?.settings).toEqual([
      { key: "DB_PASSWORD", secret: true },
      { key: "REDIS_URL", secret: true },
      { key: "API_TOKEN", secret: true },
      { key: "DATABASE_URL", secret: true },
    ]);
    // Secret values are never read for hosts: only the ConfigMap's DATABASE_URL and the inline URL connect.
    expect(relationBetween(diagram, "api", "postgres")).toBe("request");
    expect(relationBetween(diagram, "api", "redis")).toBe("request");
    expect(node(diagram, "identity-api-role")?.stencil).toBe("aws.iam-role");
    expect(node(diagram, "topic-jobs")?.stencil).toBe("rabbitmq.queue");
    expect(node(diagram, "topic-orders")?.stencil).toBe("aws.sqs");
  });

  it("a Secret's values never connect anything, even when they name a host", () => {
    const { diagram } = k8s(`apiVersion: v1
kind: Secret
metadata: { name: s }
stringData: { DATABASE_HOST: postgres }
${deployment("api", "example/api", "").replace(
  "          image: example/api\n",
  "          image: example/api\n          envFrom: [{ secretRef: { name: s } }]\n",
)}${deployment("postgres", "postgres:16")}`);
    expect(edge(diagram, "api", "postgres")).toBeUndefined();
    expect(relationBetween(diagram, "api", "secret-s")).toBe("secret");
  });
});

describe("Kubernetes import: KEDA and Strimzi", () => {
  const strimzi = (version: string, ns = "kafka") => `---
apiVersion: kafka.strimzi.io/${version}
kind: Kafka
metadata: { name: events, namespace: ${ns} }
spec: { kafka: { replicas: 3 } }
---
apiVersion: kafka.strimzi.io/${version}
kind: KafkaTopic
metadata: { name: orders, namespace: ${ns}, labels: { strimzi.io/cluster: events } }
spec: { topicName: orders.v1, partitions: 24 }
`;
  it("reads KafkaTopic and Kafka in v1beta2 and v1 alike, scoped to their cluster", () => {
    for (const version of ["v1beta2", "v1"]) {
      const { diagram, report } = k8s(strimzi(version));
      expect(diagram.nodes.map((n) => [n.id, n.stencil, n.props])).toEqual([
        ["topic-orders.v1", "kafka.topic", { partitions: 24 }],
      ]);
      expect(boundaryOf(diagram, "topic-orders.v1")).toBe("kafka");
      expect(report.notDrawn).toEqual([{ name: "Kafka events", reason: "shown through its topics" }]);
    }
    // The same topic name on two clusters is two topics.
    const { diagram } = k8s(strimzi("v1beta2", "a") + strimzi("v1", "b"));
    expect(diagram.nodes.filter((n) => n.label === "orders.v1")).toHaveLength(2);
  });

  it("a cluster with no topics is drawn; brokers named without a topic depend on it", () => {
    const { diagram } = k8s(`apiVersion: kafka.strimzi.io/v1
kind: Kafka
metadata: { name: events, namespace: kafka }
spec: {}
${deployment("audit", "example/audit", "", "apps").replace(
  "          image: example/audit\n",
  "          image: example/audit\n          env: [{ name: KAFKA_BOOTSTRAP_SERVERS, value: events-kafka-bootstrap.kafka.svc.cluster.local:9092 }]\n",
)}`);
    expect(node(diagram, "events")).toMatchObject({ stencil: "kafka.cluster" });
    expect(boundaryOf(diagram, "events")).toBe("kafka");
    expect(relationBetween(diagram, "audit", "events")).toBe("depends");
  });

  it("KEDA: Kafka, RabbitMQ, SQS and Service Bus triggers connect consumers; others are listed; replicas floor", () => {
    const { diagram, report } = k8s(`${deployment("worker", "example/worker")}${deployment("rabbitmq", "rabbitmq:3")}
---
apiVersion: v1
kind: Service
metadata: { name: rabbitmq }
spec: { selector: { app: rabbitmq } }
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: worker-scaler }
spec:
  scaleTargetRef: { name: worker }
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
    - { type: kafka, metadata: { topic: payments.v1, consumerGroup: workers, bootstrapServers: "kafka:9092" } }
    - { type: rabbitmq, metadata: { host: "amqp://rabbitmq:5672", queueName: emails } }
    - { type: aws-sqs-queue, metadata: { queueURL: "https://sqs.us-east-1.amazonaws.com/111122223333/refunds", awsRegion: us-east-1 } }
    - { type: azure-servicebus, metadata: { topicName: invoices, subscriptionName: worker, namespace: shop-sb } }
    - { type: cpu, metadata: { value: "60" } }
    - { type: cron, metadata: { start: "0 6 * * *" } }
`);
    expect(relationBetween(diagram, "topic-payments.v1", "worker")).toBe("message");
    expect(edge(diagram, "topic-payments.v1", "worker")?.props).toEqual({ group: "workers" });
    expect(relationBetween(diagram, "topic-emails", "worker")).toBe("message");
    expect(node(diagram, "topic-emails")?.stencil).toBe("rabbitmq.queue");
    expect(relationBetween(diagram, "topic-refunds", "worker")).toBe("message");
    expect(node(diagram, "topic-refunds")?.stencil).toBe("aws.sqs");
    expect(node(diagram, "topic-invoices")?.stencil).toBe("azure.service-bus.topic");
    expect(edge(diagram, "topic-invoices", "worker")?.props).toEqual({ group: "worker" });
    // KEDA keeps at least minReplicaCount running.
    expect(node(diagram, "worker")?.props).toEqual({ replicas: 2 });
    expect(report.notes).toContain("worker scales from 2 to 20 replicas (KEDA)");
    expect(report.notDrawn).toEqual([
      { name: "ScaledObject worker-scaler", reason: "cpu trigger: scaling only" },
      { name: "ScaledObject worker-scaler", reason: "cron trigger: scaling only" },
    ]);
  });

  it("an HPA's range goes in the report, and a scaler for a workload that isn't here is listed", () => {
    const { diagram, report } = k8s(`${deployment("web", "nginx:1.27")}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: web }
spec: { scaleTargetRef: { kind: Deployment, name: web }, minReplicas: 3, maxReplicas: 9 }
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: ghost }
spec: { scaleTargetRef: { name: ghost }, triggers: [] }
`);
    expect(node(diagram, "web")).toMatchObject({ stencil: "nginx", props: { replicas: 3 } });
    expect(report.notes).toContain("web scales from 3 to 9 replicas (HorizontalPodAutoscaler)");
    expect(report.notDrawn).toEqual([
      { name: "ScaledObject ghost", reason: "scales a workload that isn't in these files" },
    ]);
  });
});

describe("Kubernetes import: entry points, identities and hosts", () => {
  it("Ingress classes pick the gateway; LoadBalancer Services and Gateway API routes are entries", () => {
    const { diagram } = k8s(`${deployment("web", "example/web")}${deployment("api", "example/api")}
---
apiVersion: v1
kind: Service
metadata: { name: web }
spec: { type: LoadBalancer, selector: { app: web } }
---
apiVersion: v1
kind: Service
metadata: { name: api }
spec: { selector: { app: api } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: public, annotations: { kubernetes.io/ingress.class: traefik } }
spec: { defaultBackend: { service: { name: web, port: { number: 80 } } } }
---
apiVersion: extensions/v1beta1
kind: Ingress
metadata: { name: legacy }
spec: { backend: { serviceName: api, servicePort: 80 } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: alb }
spec: { ingressClassName: alb, rules: [{ http: { paths: [{ path: /, backend: { service: { name: missing } } }] } }] }
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: edge }
spec: { gatewayClassName: istio, listeners: [] }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: api }
spec:
  parentRefs: [{ name: edge }, { name: other-gw }]
  rules: [{ backendRefs: [{ name: api, port: 80 }] }]
`);
    expect(relationBetween(diagram, "users", "web")).toBe("request");
    expect(node(diagram, "ingress-public")?.stencil).toBe("traefik");
    expect(relationBetween(diagram, "ingress-public", "web")).toBe("request");
    expect(node(diagram, "ingress-legacy")?.stencil).toBe("load-balancer");
    expect(relationBetween(diagram, "ingress-legacy", "api")).toBe("request");
    expect(node(diagram, "ingress-alb")?.stencil).toBe("aws.elb");
    expect(node(diagram, "missing")).toMatchObject({ stencil: "generic.service", sublabel: "not in these files" });
    expect(relationBetween(diagram, "ingress-alb", "missing")).toBe("request");
    expect(node(diagram, "gateway-edge")?.stencil).toBe("istio");
    expect(relationBetween(diagram, "users", "gateway-edge")).toBe("request");
    expect(relationBetween(diagram, "gateway-edge", "api")).toBe("request");
    expect(node(diagram, "gateway-other-gw")).toMatchObject({
      stencil: "load-balancer",
      sublabel: "not in these files",
    });
    expect(relationBetween(diagram, "gateway-other-gw", "api")).toBe("request");
    // Namespace-less files: no boundaries, titled by the file.
    expect(diagram.groups ?? []).toEqual([]);
    expect(diagram.title).toBe("manifests");
  });

  it("IRSA and GKE workload identity become identity dependencies; ExternalName an outside node", () => {
    const { diagram } = k8s(`apiVersion: v1
kind: ServiceAccount
metadata: { name: aws-sa, annotations: { eks.amazonaws.com/role-arn: "arn:aws:iam::111122223333:role/orders-reader" } }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: gcp-sa, annotations: { iam.gke.io/gcp-service-account: "billing@acme-prod.iam.gserviceaccount.com" } }
${deployment("a", "example/a", "      serviceAccountName: aws-sa\n").replace(
  "          image: example/a\n",
  "          image: example/a\n          env: [{ name: PAYMENTS_URL, value: http://payments }]\n",
)}${deployment("b", "example/b", "      serviceAccountName: gcp-sa\n")}
---
apiVersion: v1
kind: Service
metadata: { name: payments }
spec: { type: ExternalName, externalName: api.stripe.com }
`);
    expect(node(diagram, "identity-orders-reader")?.stencil).toBe("aws.iam-role");
    expect(relationBetween(diagram, "a", "identity-orders-reader")).toBe("identity");
    expect(node(diagram, "identity-billing")?.stencil).toBe("gcp.service-account");
    expect(relationBetween(diagram, "b", "identity-billing")).toBe("identity");
    expect(node(diagram, "ext-api.stripe.com")?.stencil).toBe("stripe");
    expect(relationBetween(diagram, "a", "ext-api.stripe.com")).toBe("request");
  });

  it("resolves svc, svc.ns, svc.ns.svc.cluster.local and StatefulSet pod names; a Service selects every match", () => {
    const { diagram } = k8s(`${deployment("api", "example/api", "", "apps").replace(
      "          image: example/api\n",
      `          image: example/api
          env:
            - { name: CACHE_HOST, value: cache }
            - { name: DB_URL, value: "postgres://db-0.db.data.svc.cluster.local:5432/x" }
            - { name: SEARCH_URL, value: "http://search.data:9200" }
            - { name: LOCAL_HOST, value: "localhost" }
            - { name: UNKNOWN_HOST, value: "billing.payments" }
`,
    )}${deployment("cache-a", "redis:7", "", "apps").replace("app: cache-a } }\n  template", "app: cache-a } }\n  template").replaceAll("{ app: cache-a }", "{ app: cache-a, tier: cache }")}${deployment("cache-b", "redis:7", "", "apps").replaceAll("{ app: cache-b }", "{ app: cache-b, tier: cache }")}
---
apiVersion: v1
kind: Service
metadata: { name: cache, namespace: apps }
spec: { selector: { tier: cache } }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db, namespace: data }
spec:
  serviceName: db
  selector: { matchLabels: { app: db } }
  template: { metadata: { labels: { app: db } }, spec: { containers: [{ name: db, image: "postgres:16" }] } }
---
apiVersion: v1
kind: Service
metadata: { name: db, namespace: data }
spec: { clusterIP: None, selector: { app: db } }
${deployment("search", "elasticsearch:8", "", "data")}
---
apiVersion: v1
kind: Service
metadata: { name: search, namespace: data }
spec: { selector: { app: search } }
`);
    expect(relationBetween(diagram, "api", "cache-a")).toBe("request");
    expect(relationBetween(diagram, "api", "cache-b")).toBe("request");
    expect(relationBetween(diagram, "api", "db")).toBe("request");
    expect(relationBetween(diagram, "api", "search")).toBe("request");
    // "billing.payments" looks in-cluster (a namespace not in the files): not an outside API.
    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(["api", "cache-a", "cache-b", "db", "search"]);
    expect(diagram.title).toBe("apps and data");
  });
});

describe("Kubernetes import: what isn't drawn", () => {
  it("unknown kinds and non-components are listed, grouped by kind; owned Pods fold into their owner", () => {
    const pod = (name: string, owner: string) => `---
apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  ownerReferences: [{ apiVersion: apps/v1, kind: ReplicaSet, name: ${owner}, controller: true }]
spec: { containers: [{ name: web, image: "nginx:1.27" }] }
`;
    const { diagram, report } = k8s(`${deployment("web", "nginx:1.27")}
---
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: web-5d9c
  ownerReferences: [{ apiVersion: apps/v1, kind: Deployment, name: web, controller: true }]
spec:
  selector: { matchLabels: { app: web } }
  template: { metadata: { labels: { app: web } }, spec: { containers: [{ name: web, image: "nginx:1.27" }] } }
${pod("web-5d9c-a", "web-5d9c")}${pod("web-5d9c-b", "web-5d9c")}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data-1 }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data-2 }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: web }
---
apiVersion: example.com/v1alpha1
kind: Widget
metadata: { name: thing }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: unused }
data: { A: b }
---
apiVersion: v1
kind: Secret
metadata: { name: web-tls }
type: kubernetes.io/tls
data: { tls.crt: eA==, tls.key: eA== }
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata: { name: web }
`);
    expect(diagram.nodes.map((n) => n.id)).toEqual(["web"]);
    expect(report.notDrawn).toEqual([
      { name: "ReplicaSet web-5d9c", reason: "folded into its owner" },
      { name: "Pod ×2", reason: "folded into its owner" },
      { name: "PersistentVolumeClaim ×2", reason: "not a component" },
      { name: "PodDisruptionBudget web", reason: "not a component" },
      { name: "Widget thing", reason: "unknown kind (example.com)" },
      { name: "ConfigMap unused", reason: "no workload uses it" },
      { name: "Secret web-tls", reason: "TLS certificate" },
      { name: "KafkaUser web", reason: "part of Kafka" },
    ]);
  });

  it("reads kubectl's JSON and `kind: List`, and skips images that aren't components", async () => {
    const list = JSON.stringify({
      apiVersion: "v1",
      kind: "List",
      items: [
        {
          apiVersion: "apps/v1",
          kind: "StatefulSet",
          metadata: { name: "zk", namespace: "kafka" },
          spec: { template: { spec: { containers: [{ name: "zk", image: "zookeeper:3.9" }] } } },
        },
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: { name: "orders", namespace: "kafka" },
          spec: { template: { spec: { containers: [{ name: "orders", image: "example/orders" }] } } },
        },
        { kind: "Mystery" },
      ],
    });
    expect(sniffInfra(list)).toBe("kubernetes");
    expect(detectFormat(list, "dump.json")).toBe("kubernetes");
    const { diagram, report } = ok(await importText(list, "dump.json"));
    expect(diagram.nodes.map((n) => n.id)).toEqual(["orders"]);
    expect(report.notDrawn).toEqual([{ name: "StatefulSet zk", reason: "part of Kafka" }]);
    expect(report.unread).toEqual([
      { name: "dump.json, document 1", reason: "not a Kubernetes resource (no kind or apiVersion)" },
    ]);
    // An unknown image is a Kubernetes Deployment, listed as a guess with chips.
    expect(node(diagram, "orders")?.stencil).toBe("k8s.deployment");
    expect(report.guesses[0]).toMatchObject({ label: "orders", stencil: "k8s.deployment" });
    expect(report.guesses[0].alternatives).toContain("generic.service");
  });
});

describe("Kubernetes import: Helm and hostile input", () => {
  it("a Helm template says to run helm template, alone or among other files", async () => {
    const chart = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "app.fullname" . }}
  labels: {{- toYaml .Values.labels | nindent 4 }}
`;
    expect(await importText(chart, "deployment.yaml")).toEqual({ ok: false, error: HELM_TEMPLATE });
    // The template past the sniffer's first 4,000 characters: the reader still says so.
    const late = `${deployment("a", "example/a")}${"# padding\n".repeat(500)}${chart.replace("apiVersion", "---\napiVersion")}`;
    expect(await importText(late, "all.yaml")).toEqual({ ok: false, error: HELM_TEMPLATE });
    // Among rendered manifests, the template is listed rather than read.
    const outcome = ok(await importFiles([...FIXTURES, { name: "templates/deployment.yaml", text: chart }]));
    expect(outcome.report.unread).toContainEqual({
      name: "templates/deployment.yaml",
      reason: "a Helm template: import “helm template” output instead",
    });
  });

  it("runs its own patterns in linear time on adversarial input", () => {
    for (const evil of [
      "$(".repeat(50_000),
      "$$".repeat(50_000),
      "{{" + " ".repeat(200_000),
      "{{-".repeat(50_000),
      "a-kafka-".repeat(10_000),
      ".svc".repeat(30_000),
    ]) {
      const text = `${deployment("a", "example/a").replace(
        "          image: example/a\n",
        `          image: example/a\n          env: [{ name: X_URL, value: ${JSON.stringify(evil)} }, { name: KAFKA_BROKERS, value: ${JSON.stringify(evil)} }]\n`,
      )}---\napiVersion: v1\nkind: ConfigMap\nmetadata: { name: c }\ndata: { k: ${JSON.stringify(evil)} }\n`;
      const started = performance.now();
      importKubernetes([{ name: "evil.yaml", text }]);
      expect(performance.now() - started, evil.slice(0, 12)).toBeLessThan(perfBudget(1_000));
    }
  });

  it("the alias bomb fails fast, in a manifest too", async () => {
    const bomb = readFileSync("tests/fixtures/imports/hostile/yaml-bomb.yaml", "utf8");
    const started = performance.now();
    const outcome = await importText(
      `apiVersion: v1\nkind: ConfigMap\nmetadata: { name: x }\n${bomb.replace("services:", "data:")}`,
    );
    expect(outcome).toEqual({ ok: false, error: TOO_MANY_ALIASES });
    expect(performance.now() - started).toBeLessThan(perfBudget(1_000));
  });

  it("refuses deep nesting", async () => {
    let deep = "x: 1";
    for (let i = 0; i < 60; i++) deep = `a:\n${deep.replace(/^/gm, "  ")}`;
    const outcome = await importText(
      `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\ndata:\n${deep.replace(/^/gm, "  ")}\n`,
    );
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/nested too deeply/) });
  });

  it("reads 2,000 documents within budget, and refuses more", () => {
    const docs = Array.from(
      { length: 1_000 },
      (_, i) => `---
apiVersion: apps/v1
kind: Deployment
metadata: { name: svc-${i}, namespace: ns-${i % 20} }
spec:
  template:
    metadata: { labels: { app: svc-${i} } }
    spec: { containers: [{ name: a, image: example/a, env: [{ name: NEXT_URL, value: "http://svc-${(i + 1) % 1_000}.ns-${(i + 1) % 20}" }] }] }
---
apiVersion: v1
kind: Service
metadata: { name: svc-${i}, namespace: ns-${i % 20} }
spec: { selector: { app: svc-${i} } }
`,
    ).join("");
    const started = performance.now();
    const { diagram } = k8s(docs);
    expect(performance.now() - started).toBeLessThan(perfBudget(6_000));
    expect(diagram.nodes).toHaveLength(1_000);
    expect(diagram.edges).toHaveLength(1_000);
    expect(diagram.groups).toHaveLength(20);
    const more = `${docs}---\napiVersion: v1\nkind: ConfigMap\nmetadata: { name: one-too-many }\n`;
    expect(() => importKubernetes([{ name: "big.yaml", text: more }])).toThrow(/more than 2,000/);
  });

  it("caps resources from Lists too", () => {
    const items = Array.from(
      { length: MAX_RESOURCES + 1 },
      (_, i) => `{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"c${i}"}}`,
    );
    const text = `{"apiVersion":"v1","kind":"List","items":[${items.join(",")}]}`;
    expect(() => importKubernetes([{ name: "list.json", text }])).toThrow(/more than 10,000 resources/);
  });

  it("keeps __proto__ and constructor as plain names, and never pollutes prototypes", () => {
    const { diagram } = k8s(`${deployment("__proto__", "redis:7")}${deployment("constructor", "example/c").replace(
      "          image: example/c\n",
      "          image: example/c\n          env: [{ name: CACHE_HOST, value: __proto__ }]\n",
    )}
---
apiVersion: v1
kind: Service
metadata: { name: __proto__ }
spec: { selector: { __proto__: x, app: __proto__ } }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: m }
data: { __proto__: { polluted: "yes" }, constructor: x }
`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(diagram.nodes.map((n) => n.label).sort()).toEqual(["__proto__", "__proto__", "constructor"]);
  });
});

describe("Kubernetes import: review findings", () => {
  /** A Deployment with the given containers (YAML flow maps, one per line). */
  const pods = (name: string, containers: string[], ns = "") => `---
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${name}${ns ? `, namespace: ${ns}` : ""} }
spec:
  template:
    metadata: { labels: { app: ${name} } }
    spec:
      containers:
${containers.map((c) => `        - ${c}`).join("\n")}
`;
  const targets = ["db-a", "db-b", "other"].map((n) => deployment(n, "example/store")).join("");

  it("keeps each container's environment its own: both connections, in either order", () => {
    const main = "{ name: api, image: example/api, env: [{ name: DB_HOST, value: db-a }] }";
    const sidecar = "{ name: sync, image: example/sync, env: [{ name: DB_HOST, value: db-b }] }";
    for (const order of [
      [main, sidecar],
      [sidecar, main],
    ]) {
      const { diagram } = k8s(pods("api", order) + targets);
      expect(relationBetween(diagram, "api", "db-a")).toBe("request");
      expect(relationBetween(diagram, "api", "db-b")).toBe("request");
    }
  });

  it("expands $(VAR) only from the same container's variables", () => {
    const { diagram } = k8s(
      pods("api", [
        "{ name: api, image: example/api, env: [{ name: HOST_SEGMENT, value: other }] }",
        "{ name: proxy, image: example/proxy, env: [{ name: UPSTREAM_URL, value: 'http://$(HOST_SEGMENT)' }] }",
      ]) + targets,
    );
    expect(edge(diagram, "api", "other")).toBeUndefined();
    const same = k8s(
      pods("api", [
        "{ name: api, image: example/api, env: [{ name: HOST_SEGMENT, value: other }, { name: UPSTREAM_URL, value: 'http://$(HOST_SEGMENT):80' }] }",
      ]) + targets,
    );
    expect(relationBetween(same.diagram, "api", "other")).toBe("request");
  });

  describe("envFrom precedence", () => {
    const sources = `---
apiVersion: v1
kind: ConfigMap
metadata: { name: cfg }
data: { DB_HOST: db-a }
---
apiVersion: v1
kind: Secret
metadata: { name: sec }
stringData: { DB_HOST: db-b-from-secret }
`;
    it("a later Secret overrides a ConfigMap's value without its own being read", () => {
      const { diagram } = k8s(
        sources +
          pods("api", [
            "{ name: api, image: example/api, envFrom: [{ configMapRef: { name: cfg } }, { secretRef: { name: sec } }] }",
          ]) +
          targets,
      );
      expect(edge(diagram, "api", "db-a")).toBeUndefined();
      expect(edge(diagram, "api", "db-b")).toBeUndefined();
      expect(relationBetween(diagram, "api", "configmap-cfg")).toBe("config");
      expect(relationBetween(diagram, "api", "secret-sec")).toBe("secret");
      expect(JSON.stringify(diagram)).not.toContain("db-b-from-secret");
    });

    it("a later ConfigMap overrides a Secret; explicit env beats every envFrom source", () => {
      const reverse = k8s(
        sources +
          pods("api", [
            "{ name: api, image: example/api, envFrom: [{ secretRef: { name: sec } }, { configMapRef: { name: cfg } }] }",
          ]) +
          targets,
      );
      expect(relationBetween(reverse.diagram, "api", "db-a")).toBe("request");
      const explicit = k8s(
        sources +
          pods("api", [
            "{ name: api, image: example/api, envFrom: [{ configMapRef: { name: cfg } }], env: [{ name: DB_HOST, value: db-b }] }",
          ]) +
          targets,
      );
      expect(edge(explicit.diagram, "api", "db-a")).toBeUndefined();
      expect(relationBetween(explicit.diagram, "api", "db-b")).toBe("request");
      // env from a Secret also beats envFrom, as an unknown value.
      const secretEnv = k8s(
        sources +
          pods("api", [
            "{ name: api, image: example/api, envFrom: [{ configMapRef: { name: cfg } }], env: [{ name: DB_HOST, valueFrom: { secretKeyRef: { name: sec, key: DB_HOST } } }] }",
          ]) +
          targets,
      );
      expect(edge(secretEnv.diagram, "api", "db-a")).toBeUndefined();
    });
  });

  describe("bounded $(VAR) expansion", () => {
    it("never builds a value past MAX_VALUE, nor follows more than its share of references", () => {
      const env = new Map([["A", "x".repeat(1_500)]]);
      expect(expandVars("$(A)$(A)", env)).toBe(OPAQUE);
      expect(expandVars("http://$(A)", env)).toBe(`http://${"x".repeat(1_500)}`);
      expect(expandVars("$(B)", new Map([["B", OPAQUE]]))).toBe(OPAQUE);
      expect(expandVars("$(UNSET) and $$(A)", env)).toBe("$(UNSET) and $(A)");
      expect(expandVars("$(A)".repeat(ENV_LIMITS.maxReferences + 1), new Map([["A", "y"]]))).toBe(OPAQUE);
      expect(expandVars("y".repeat(MAX_VALUE + 1), env)).toBe(OPAQUE);
    });

    it("a chain of doubling variables stays small and fast", () => {
      const vars = [`{ name: V0, value: "${"x".repeat(64)}" }`];
      for (let i = 1; i <= 40; i++) vars.push(`{ name: V${i}, value: "$(V${i - 1})$(V${i - 1})" }`);
      vars.push('{ name: DB_URL, value: "http://$(V40)" }', '{ name: CACHE_HOST, value: "other" }');
      const started = performance.now();
      const { diagram, report } = k8s(
        pods("api", [`{ name: api, image: example/api, env: [${vars.join(", ")}] }`]) + targets,
      );
      expect(performance.now() - started).toBeLessThan(perfBudget(1_000));
      expect(JSON.stringify([diagram, report]).length).toBeLessThan(50_000);
      // The bounded values don't stop the rest of the container's settings from being read.
      expect(relationBetween(diagram, "api", "other")).toBe("request");
    });

    it("budgets ConfigMap settings across workloads, and says so", () => {
      const data = Array.from({ length: 1_000 }, (_, i) => `  K${i}: v${i}`).join("\n");
      const many = Array.from({ length: 500 }, (_, i) =>
        pods(`w${i}`, ["{ name: a, image: example/a, envFrom: [{ configMapRef: { name: big } }] }"]),
      ).join("");
      const started = performance.now();
      const { report } = k8s(`apiVersion: v1\nkind: ConfigMap\nmetadata: { name: big }\ndata:\n${data}\n${many}`);
      expect(performance.now() - started).toBeLessThan(perfBudget(6_000));
      expect(report.notes.some((n) => n.startsWith("Settings past the first 100,000 weren't read"))).toBe(true);
    });
  });

  describe("host names", () => {
    it("parses DNS syntax before looking anything up", () => {
      expect(parseServiceHost("postgres.data.svc.cluster.local")).toEqual([{ service: "postgres", namespace: "data" }]);
      expect(parseServiceHost("db-0.db.data.svc")).toEqual([{ pod: "db-0", service: "db", namespace: "data" }]);
      expect(parseServiceHost("db-0.db")).toEqual([
        { pod: "db-0", service: "db" },
        { service: "db-0", namespace: "db" },
      ]);
      expect(parseServiceHost("orders")).toEqual([{ service: "orders" }]);
      expect(parseServiceHost("orders.shop")).toEqual([{ service: "orders", namespace: "shop" }]);
      expect(parseServiceHost("api.stripe.com")).toEqual([]);
      expect(parseServiceHost("x.svc")).toEqual([]);
      expect(parseServiceHost("node.cluster.local")).toEqual([]);
    });

    it("a namespace that isn't in the files stays unresolved, never read as a local name", () => {
      const { diagram } = k8s(
        pods("api", [
          "{ name: api, image: example/api, env: [{ name: DB_HOST, value: postgres.data.svc.cluster.local }] }",
        ]) +
          deployment("data", "example/data") +
          deployment("postgres", "postgres:16"),
      );
      expect(edge(diagram, "api", "data")).toBeUndefined();
      expect(edge(diagram, "api", "postgres")).toBeUndefined();
      expect(diagram.nodes.map((n) => n.id).sort()).toEqual(["api", "data", "postgres"]);
    });

    it("resolves a host with no Service through an index, in linear time", () => {
      const settings = Array.from({ length: 20 }, (_, i) => `{ name: H${i}_HOST, value: missing-${i} }`).join(", ");
      const items = Array.from({ length: 2_000 }, (_, i) => ({
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: `w${i}` },
        spec: { template: { metadata: { labels: { team: "a", tier: "b" } }, spec: { containers: [] as unknown[] } } },
      }));
      const text = JSON.stringify({ apiVersion: "v1", kind: "List", items }).replaceAll(
        '"containers":[]',
        `"containers":[{"name":"a","image":"example/a","env":[${settings.replace(
          /\{ name: (\w+), value: ([\w-]+) \}/g,
          '{"name":"$1","value":"$2"}',
        )}]}]`,
      );
      const started = performance.now();
      const graph = readKubernetes([{ name: "list.json", text }]);
      expect(performance.now() - started).toBeLessThan(perfBudget(2_000));
      expect(graph.components).toHaveLength(2_000);
    });
  });

  describe("Kafka identity", () => {
    const topic = (ns: string, cluster: string | undefined, partitions: number) => `---
apiVersion: kafka.strimzi.io/v1
kind: KafkaTopic
metadata: { name: orders, namespace: ${ns}${cluster ? `, labels: { strimzi.io/cluster: ${cluster} }` : ""} }
spec: { topicName: orders.v1, partitions: ${partitions} }
`;
    it("topics keep their cluster without its Kafka manifest; unlabeled ones are scoped to their namespace", () => {
      const labelled = k8s(topic("x", "a", 3) + topic("y", "b", 6));
      expect(labelled.diagram.nodes.map((n) => [boundaryOf(labelled.diagram, n.id), n.props])).toEqual([
        ["x", { partitions: 3 }],
        ["y", { partitions: 6 }],
      ]);
      const unlabelled = k8s(topic("x", undefined, 3) + topic("y", undefined, 6));
      expect(unlabelled.diagram.nodes).toHaveLength(2);
    });

    it("a bootstrap host names the cluster too: settings meet the labelled topic, or depend on the cluster", () => {
      const { diagram } = k8s(
        topic("kafka", "events", 12) +
          pods(
            "reader",
            [
              "{ name: r, image: example/r, env: [{ name: KAFKA_BOOTSTRAP_SERVERS, value: 'events-kafka-bootstrap.kafka.svc:9092' }, { name: INPUT_TOPIC, value: orders.v1 }] }",
            ],
            "apps",
          ) +
          pods(
            "auditor",
            [
              "{ name: a, image: example/a, env: [{ name: KAFKA_BROKERS, value: 'audit-kafka-bootstrap.kafka:9092' }] }",
            ],
            "apps",
          ),
      );
      expect(relationBetween(diagram, "topic-orders.v1", "reader")).toBe("message");
      expect(diagram.nodes.filter((n) => n.label === "orders.v1")).toHaveLength(1);
      expect(node(diagram, "audit")).toMatchObject({ stencil: "kafka.cluster", sublabel: "not in these files" });
      expect(relationBetween(diagram, "auditor", "audit")).toBe("depends");
    });
  });

  it("keeps a workload whose owner isn't drawn (an operator's custom resource)", () => {
    const { diagram, report } = k8s(`apiVersion: example.com/v1
kind: Database
metadata: { name: main }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db-proxy
  ownerReferences: [{ apiVersion: example.com/v1, kind: Database, name: main, controller: true }]
spec: { template: { spec: { containers: [{ name: p, image: "example/proxy" }] } } }
`);
    expect(diagram.nodes.map((n) => n.id)).toEqual(["db-proxy"]);
    expect(report.notDrawn).toEqual([{ name: "Database main", reason: "unknown kind (example.com)" }]);
  });

  it.each(["apiVersion", "kind", "metadata"])("imports Kubernetes JSON with %s first", async (first) => {
    const fields: Record<string, unknown> = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "orders" },
      spec: { template: { spec: { containers: [{ name: "orders", image: "postgres:16" }] } } },
    };
    const ordered = Object.fromEntries([
      [first, fields[first]],
      ...Object.entries(fields).filter(([k]) => k !== first),
    ]);
    const text = JSON.stringify(ordered, null, 2);
    expect(detectFormat(text, "orders.json")).toBe("kubernetes");
    const { diagram } = ok(await importText(text, "orders.json"));
    expect(diagram.nodes.map((n) => [n.id, n.stencil])).toEqual([["orders", "postgres"]]);
  });

  it("reads a JSON ConfigMap whose kind comes after 4,000 characters of data, among other files", async () => {
    const data = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`KEY_${i}`, `value-${i}`]));
    const cm = JSON.stringify({
      data: { ...data, DB_HOST: "other" },
      metadata: { name: "cfg" },
      apiVersion: "v1",
      kind: "ConfigMap",
    });
    expect(cm.indexOf('"kind"')).toBeGreaterThan(4_000);
    const outcome = ok(
      await importFiles([
        { name: "cfg.json", text: cm },
        {
          name: "app.yaml",
          text:
            pods("api", ["{ name: api, image: example/api, envFrom: [{ configMapRef: { name: cfg } }] }"]) + targets,
        },
      ]),
    );
    expect(relationBetween(outcome.diagram, "api", "other")).toBe("request");
    expect(outcome.report.unread).toEqual([]);
  });

  it("names the namespace in report rows when two workloads share a name", () => {
    const { report } = k8s(
      deployment("orders", "example/orders:1", "", "staging") +
        deployment("orders", "example/orders:1", "", "production"),
    );
    expect(report.guesses.map((g) => g.label).sort()).toEqual(["orders (production)", "orders (staging)"]);
  });
});
