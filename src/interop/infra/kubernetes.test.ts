import { presentReportLine } from "../ui/importMessages";
import { formatImportMessage } from "../ui/importMessages";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { relationOf } from "../../model/relations";
import { estimateCardSize } from "../../canvas/nodes/size";
import { detectFormat, importFiles, importText, type ImportOutcome } from "../formats";
import { sniffInfra } from "../sniff";
import type { ImportReport } from "./graph";
import { importKubernetes, replayOutcome } from "./pipeline";
import { HELM_TEMPLATE, MAX_RESOURCES, SecretUsers } from "./kubernetes";
import { parseServiceHost, WorkloadNames } from "./k8sHosts";
import { containerEnv, ENV_LIMITS, expandVars, newEnvBudget, OPAQUE } from "./k8sSettings";
import { MAX_VALUE } from "./settings";
import { TOO_MANY_ALIASES } from "./yaml";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import { runChecks } from "../../checks/run";

// Kubernetes import against the self-written fixture set (tests/fixtures/imports/k8s), as
// docs/research/imports.md § Mapping: Kubernetes describes it, plus KEDA, Strimzi, entry points, identities,
// what isn't drawn, and hostile input.

/**
 * While `parsed.cache` is set, each text is parsed once: a scaling test then times the reader, not the YAML library
 * (whose time would hide a quadratic reader). Off everywhere else.
 */
const parsed = vi.hoisted(() => ({ cache: undefined as Map<string, unknown[]> | undefined }));
vi.mock("./yaml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./yaml")>();
  return {
    ...actual,
    readYaml(text: string, fileName: string): unknown[] {
      if (!parsed.cache) return actual.readYaml(text, fileName);
      const docs = parsed.cache.get(text) ?? actual.readYaml(text, fileName);
      parsed.cache.set(text, docs);
      return docs;
    },
  };
});

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
    // `replicas: 1` in the manifest is said, so single-point can read it; KEDA's own floor of 1 says it too.
    expect(n("postgres").props).toEqual({ replicas: 1 });
    expect(n("redis").props).toEqual({ replicas: 1 });
    expect(n("payments-worker").props).toEqual({ replicas: 1 });
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
    expect(formatImportMessage(report.summary!)).toBe(
      "Imported “shop and kafka” from Kubernetes: 14 nodes, 13 connections.",
    );
    expect(report.format).toBe("Kubernetes");
    expect(report.boundaries).toBe(2);
    expect(report.guesses).toEqual([]);
    expect(
      report.inferred
        .map((line) => ({ ...line, ...(line.note ? { note: formatImportMessage(line.note) } : {}) }))
        .map((c) => `${c.from} → ${c.to} ${c.evidence}${c.guess ? " (guess)" : ""}`),
    ).toEqual([
      // Two namespaces: each row says where its nodes live.
      "orders-api (shop) → redis (shop) REDIS_URL",
      "orders-api (shop) → postgres (shop) DATABASE_HOST",
      "orders-api (shop) → orders.placed.v1 (kafka) ORDERS_TOPIC (guess)",
      "payments-worker (shop) → payments.completed.v1 (kafka) OUTPUT_TOPIC",
      "settlement-report (shop) → postgres (shop) DATABASE_HOST",
    ]);
    expect(report.notDrawn.map(presentReportLine)).toEqual([
      { name: "Kafka shop-kafka", reason: "shown through its topics" },
      { name: "ServiceMonitor orders-api", reason: "unknown kind (monitoring.coreos.com)" },
    ]);
    expect(report.notes.map(formatImportMessage)).toEqual([
      "storefront: a Service with no workload in these files",
      "payments-worker scales from 1 to 12 replicas (KEDA)",
    ]);
    expect(report.unread.map(presentReportLine)).toEqual([]);
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

describe("Kubernetes import: Strimzi KafkaUser ACLs", () => {
  /** A Kafka cluster in `shop` with two topics, a KafkaUser, and a workload that reads the user's Secret. */
  const set = (opts: { prefix?: string; secret?: string; extraEnv?: string; acls?: string } = {}) => `---
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata: { name: events, namespace: shop }
spec:
  kafka: { replicas: 3 }
  entityOperator: { userOperator: { ${opts.prefix ? `secretPrefix: ${opts.prefix}` : ""} } }
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata: { name: orders, namespace: shop, labels: { strimzi.io/cluster: events } }
spec: { topicName: orders.v1 }
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata: { name: payments, namespace: shop, labels: { strimzi.io/cluster: events } }
spec: { topicName: payments.v1 }
---
apiVersion: v1
kind: Secret
metadata: { name: ${opts.secret ?? "orders-app"}, namespace: shop }
data: { password: YWNsLWxlYWstdmFsdWU= }
stringData: { sasl.jaas.config: acl-leak-value }
---
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata: { name: orders-app, namespace: shop, labels: { strimzi.io/cluster: events } }
spec:
  authentication: { type: scram-sha-512 }
  authorization:
    type: simple
    acls:
${
  opts.acls ??
  `      - { resource: { type: topic, name: orders.v1, patternType: literal }, operations: [Write, Describe] }
      - { resource: { type: topic, name: payments.v1 }, operation: Read }
      - { resource: { type: group, name: orders-app-group }, operations: [Read] }
      - { resource: { type: topic, name: audit., patternType: prefix }, operations: [Read] }
      - { resource: { type: topic, name: orders.v1 }, operations: [Describe] }
      - { type: deny, resource: { type: topic, name: secret-topic }, operations: [Read] }`
}
${deployment("orders-app", "example/orders", "", "shop").replace(
  "          image: example/orders\n",
  `          image: example/orders\n          env:\n            - { name: KAFKA_PASSWORD, valueFrom: { secretKeyRef: { name: ${opts.secret ?? "orders-app"}, key: password } } }\n${opts.extraEnv ?? ""}`,
)}`;

  it("a workload using a KafkaUser's Secret produces and consumes what its literal ACLs allow", () => {
    const { diagram, report } = k8s(set());
    expect(relationBetween(diagram, "orders-app", "topic-orders.v1")).toBe("message");
    expect(relationBetween(diagram, "topic-payments.v1", "orders-app")).toBe("message");
    // The one literal group ACL is the consumer group.
    expect(edge(diagram, "topic-payments.v1", "orders-app")?.props).toEqual({ group: "orders-app-group" });
    // Describe alone, a deny, and a prefix draw nothing; the prefix is said.
    expect(diagram.nodes.map((n) => n.id)).not.toContain("topic-secret-topic");
    expect(diagram.nodes.filter((n) => n.stencil === "kafka.topic")).toHaveLength(2);
    expect(report.notes.map(formatImportMessage)).toContain(
      "orders-app (KafkaUser) may read topics starting “audit.”: not drawn",
    );
    expect(report.notDrawn.map(presentReportLine)).toContainEqual({
      name: "KafkaUser orders-app",
      reason: "shown as its workloads' flows",
    });
    // Each flow names the KafkaUser that allows it, under a heading that says so.
    expect(formatImportMessage(report.connectionsTitle!)).toBe("Connections found in settings and KafkaUser ACLs");
    expect(
      report.inferred
        .map((line) => ({ ...line, ...(line.note ? { note: formatImportMessage(line.note) } : {}) }))
        .filter((c) => c.evidence === "KafkaUser orders-app")
        .map((c) => `${c.from} → ${c.to}`),
    ).toEqual(["orders-app → orders.v1", "payments.v1 → orders-app"]);
  });

  it("follows the cluster's secretPrefix, and lists a user no workload here uses", () => {
    const prefixed = k8s(set({ prefix: "kafka-", secret: "kafka-orders-app" })).diagram;
    expect(relationBetween(prefixed, "orders-app", "topic-orders.v1")).toBe("message");
    // The prefix is set but the workload reads a Secret named like the user: not this user's credentials.
    const { diagram, report } = k8s(set({ prefix: "kafka-" }));
    expect(edge(diagram, "orders-app", "topic-orders.v1")).toBeUndefined();
    expect(report.notDrawn.map(presentReportLine)).toContainEqual({
      name: "KafkaUser orders-app",
      reason: "its ACLs aren't drawn: no workload in these files uses its Secret",
    });
  });

  it("adds nothing where settings already connect the pair", () => {
    const { diagram } = k8s(
      set({
        extraEnv:
          "            - { name: KAFKA_BOOTSTRAP_SERVERS, value: events-kafka-bootstrap.shop.svc:9092 }\n" +
          "            - { name: INPUT_TOPIC, value: payments.v1 }\n            - { name: CONSUMER_GROUP, value: from-settings }\n",
      }),
    );
    const into = diagram.edges.filter((e) => e.from === "topic-payments.v1" && e.to === "orders-app");
    expect(into).toHaveLength(1);
    expect(into[0].props).toEqual({ group: "from-settings" });
  });

  it("never draws a flow a deny ACL forbids: literal, prefix and wildcard denies, and a denied group", () => {
    const acls = (lines: string[]) => lines.map((l) => `      - ${l}`).join("\n");
    const allows = [
      "{ resource: { type: topic, name: orders.v1 }, operations: [Write] }",
      "{ resource: { type: topic, name: payments.v1 }, operations: [Read] }",
      "{ resource: { type: group, name: orders-app-group }, operations: [Read] }",
    ];
    // A deny for the same topic and operation wins over the allow (Kafka checks denies first).
    let d = k8s(
      set({
        acls: acls([...allows, "{ type: deny, resource: { type: topic, name: orders.v1 }, operations: [Write] }"]),
      }),
    ).diagram;
    expect(edge(d, "orders-app", "topic-orders.v1")).toBeUndefined();
    expect(relationBetween(d, "topic-payments.v1", "orders-app")).toBe("message");
    // A prefix deny, and a deny for All.
    d = k8s(
      set({
        acls: acls([
          ...allows,
          "{ type: deny, resource: { type: topic, name: pay, patternType: prefix }, operations: [All] }",
        ]),
      }),
    ).diagram;
    expect(edge(d, "topic-payments.v1", "orders-app")).toBeUndefined();
    expect(relationBetween(d, "orders-app", "topic-orders.v1")).toBe("message");
    // A wildcard deny, even one for a single host, forbids everything it names.
    d = k8s(
      set({
        acls: acls([
          ...allows,
          '{ type: deny, host: "10.0.0.9", resource: { type: topic, name: "*" }, operations: [Read, Write] }',
        ]),
      }),
    ).diagram;
    expect(d.edges.filter((e) => relationOf(e) === "flow")).toEqual([]);
    // A denied group isn't the consumer group.
    d = k8s(
      set({
        acls: acls([
          ...allows,
          "{ type: deny, resource: { type: group, name: orders-app-group }, operations: [Read] }",
        ]),
      }),
    ).diagram;
    expect(edge(d, "topic-payments.v1", "orders-app")?.props).toBeUndefined();
  });

  it("lists an allow for some hosts only instead of drawing it", () => {
    const { diagram, report } = k8s(
      set({ acls: '      - { host: "10.0.0.7", resource: { type: topic, name: orders.v1 }, operations: [Write] }' }),
    );
    expect(edge(diagram, "orders-app", "topic-orders.v1")).toBeUndefined();
    expect(report.notes.map(formatImportMessage)).toContain(
      "orders-app (KafkaUser) may write orders.v1 from some hosts only: not drawn",
    );
  });

  it("gives settings' ungrouped consumers the user's group, so two consumers share it rather than each get a copy", () => {
    // Two workloads use the user's Secret: one names its input topic in a setting (no group), the other only
    // through the ACL. Both read payments.v1 in the ACL's group, so Live shares messages between them.
    const second = deployment("orders-app-2", "example/orders", "", "shop").replace(
      "          image: example/orders\n",
      "          image: example/orders\n          env:\n            - { name: KAFKA_PASSWORD, valueFrom: { secretKeyRef: { name: orders-app, key: password } } }\n",
    );
    const { diagram } = k8s(
      set({
        extraEnv:
          "            - { name: KAFKA_BOOTSTRAP_SERVERS, value: events-kafka-bootstrap.shop.svc:9092 }\n" +
          "            - { name: INPUT_TOPIC, value: payments.v1 }\n",
      }) + second,
    );
    for (const w of ["orders-app", "orders-app-2"]) {
      const into = diagram.edges.filter((e) => e.from === "topic-payments.v1" && e.to === w);
      expect(into, w).toHaveLength(1);
      expect(into[0].props, w).toEqual({ group: "orders-app-group" });
    }
  });

  it("finds each KafkaUser's workloads through an index, in linear time", () => {
    // The reader indexes workloads by the Secrets they use (SecretUsers) and asks it once per KafkaUser. A scan of
    // the workloads per user would be quadratic: 8x the workloads and users would take 64x as long. Compared against
    // an eighth of the input, not a wall-clock budget; the fastest of a few runs evens out noise. Users whose Secret
    // nobody uses are the common case and the worst for a scan.
    const run = (n: number) => () => {
      const index = new SecretUsers();
      for (let i = 0; i < n; i++) index.add(`ns-${i % 40}`, `own-${i}`, `w${i}`);
      let found = 0;
      for (let i = 0; i < n * 5; i++) found += index.get(`ns-${i % 40}`, `user-${i}`).length;
      return { index, found };
    };
    const { index, found } = run(8_000)();
    expect(found).toBe(0);
    expect(index.get(`ns-${7_999 % 40}`, "own-7999")).toEqual(["w7999"]);
    expect(growth(run(1_000), run(1_000 * GROWTH_FACTOR))).toBeLessThan(LINEAR_LIMIT);
  });

  it("never reads the Secret's values", () => {
    const outcome = importKubernetes([{ name: "kafka.yaml", text: set() }]);
    const out = JSON.stringify(outcome);
    for (const secret of ["YWNsLWxlYWstdmFsdWU", "acl-leak-value"]) expect(out, secret).not.toContain(secret);
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
      expect(report.notDrawn.map(presentReportLine)).toEqual([
        { name: "Kafka events", reason: "shown through its topics" },
      ]);
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
    expect(report.notes.map(formatImportMessage)).toContain("worker scales from 2 to 20 replicas (KEDA)");
    expect(report.notDrawn.map(presentReportLine)).toEqual([
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
    expect(report.notes.map(formatImportMessage)).toContain(
      "web scales from 3 to 9 replicas (HorizontalPodAutoscaler)",
    );
    expect(report.notDrawn.map(presentReportLine)).toEqual([
      { name: "ScaledObject ghost", reason: "scales a workload that isn't in these files" },
    ]);
  });
});

describe("Kubernetes import: replicas", () => {
  const scaledTo = (n: number | "") => (n === "" ? "" : `  replicas: ${n}\n`);
  /** An Ingress → web (NGINX) → api chain, with web's replicas and anything after it. */
  const chain = (replicas: number | "", after = "") =>
    `${deployment("web", "nginx:1.27").replace("spec:\n", `spec:\n${scaledTo(replicas)}`)}${deployment("api", "example/api")}
---
apiVersion: v1
kind: Service
metadata: { name: web }
spec: { selector: { app: web } }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: shop }
spec:
  ingressClassName: traefik
  rules: [{ http: { paths: [{ path: /, pathType: Prefix, backend: { service: { name: web, port: { number: 80 } } } }] } }]
${after}`;
  const replicasOf = (text: string) => node(k8s(text).diagram, "web")?.props?.replicas;
  const hpa = (min: string) => `---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: web }
spec: { scaleTargetRef: { kind: Deployment, name: web }, ${min}maxReplicas: 5 }
`;
  const keda = (min: string) => `---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: web }
spec: { scaleTargetRef: { name: web }, ${min}triggers: [{ type: cpu, metadata: { value: "60" } }] }
`;

  it("writes the count the manifest sets, one included, and leaves an unset one unset", () => {
    expect(replicasOf(chain(1))).toBe(1);
    expect(replicasOf(chain(4))).toBe(4);
    expect(replicasOf(chain(""))).toBeUndefined();
    // Scaled to zero isn't a count to draw.
    expect(replicasOf(chain(0))).toBeUndefined();
  });

  it("an autoscaler owns the count: only its own floor says one", () => {
    // The manifest's 1 is the autoscaler's to change; a minimum it doesn't set isn't evidence either.
    expect(replicasOf(chain(1, hpa("")))).toBeUndefined();
    expect(replicasOf(chain(1, keda("")))).toBeUndefined();
    expect(replicasOf(chain(1, keda("minReplicaCount: 0, ")))).toBeUndefined();
    // Its floor, when the file sets it.
    expect(replicasOf(chain("", hpa("minReplicas: 1, ")))).toBe(1);
    expect(replicasOf(chain(1, keda("minReplicaCount: 1, ")))).toBe(1);
    expect(replicasOf(chain(1, hpa("minReplicas: 2, ")))).toBe(2);
    // A count above the floor stays, as before; a KEDA object and its HPA together keep the higher floor.
    expect(replicasOf(chain(4, hpa("minReplicas: 2, ")))).toBe(4);
    expect(replicasOf(chain(1, keda("minReplicaCount: 3, ") + hpa("minReplicas: 1, ")))).toBe(3);
  });

  it("single-point sees an imported one-replica gateway on the only way in, and nothing when it's unset", () => {
    const findings = (text: string) =>
      runChecks(k8s(text).diagram)
        .findings.filter((f) => f.rule === "single-point")
        .map((f) => `${f.severity} ${f.id}`);
    expect(findings(chain(1))).toEqual(["suggestion single-point:web"]);
    expect(findings(chain(""))).toEqual([]);
    expect(findings(chain(2))).toEqual([]);
    expect(findings(chain(1, hpa("")))).toEqual([]);
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
    expect(report.notDrawn.map(presentReportLine)).toEqual([
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
    expect(report.notDrawn.map(presentReportLine)).toEqual([{ name: "StatefulSet zk", reason: "part of Kafka" }]);
    expect(report.unread.map(presentReportLine)).toEqual([
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
    expect(outcome.report.unread.map(presentReportLine)).toContainEqual({
      name: "templates/deployment.yaml",
      reason: "a Helm template: import “helm template” output instead",
    });
  });

  it("runs its own patterns in linear time on adversarial input", () => {
    // Each hostile value against an eighth of it: a pattern that backtracks takes 64 times as long or more, a linear
    // one about 8 (parsing included). A ratio, not a budget in ms, so a busy machine doesn't fail it.
    const manifest = (evil: string) =>
      `${deployment("a", "example/a").replace(
        "          image: example/a\n",
        `          image: example/a\n          env: [{ name: X_URL, value: ${JSON.stringify(evil)} }, { name: KAFKA_BROKERS, value: ${JSON.stringify(evil)} }]\n`,
      )}---\napiVersion: v1\nkind: ConfigMap\nmetadata: { name: c }\ndata: { k: ${JSON.stringify(evil)} }\n`;
    for (const [unit, times, head = ""] of [
      ["$(", 12_000],
      ["$$", 12_000],
      [" ", 48_000, "{{"],
      ["{{-", 12_000],
      ["a-kafka-", 2_400],
      [".svc", 8_000],
    ] as const) {
      const run = (n: number) => {
        const text = manifest(head + unit.repeat(n));
        return () => importKubernetes([{ name: "evil.yaml", text }]);
      };
      expect(growth(run(times / GROWTH_FACTOR), run(times), { samples: 3 }), head + unit).toBeLessThan(LINEAR_LIMIT);
    }
  });

  it("the alias bomb fails fast, in a manifest too", async () => {
    // The bound is the alias limit, proved by the error it throws: without it the bomb expands to millions of
    // values and the test runs into its timeout.
    const bomb = readFileSync("tests/fixtures/imports/hostile/yaml-bomb.yaml", "utf8");
    const outcome = await importText(
      `apiVersion: v1\nkind: ConfigMap\nmetadata: { name: x }\n${bomb.replace("services:", "data:")}`,
    );
    expect(outcome).toEqual({ ok: false, error: TOO_MANY_ALIASES });
  });

  it("refuses deep nesting", async () => {
    let deep = "x: 1";
    for (let i = 0; i < 60; i++) deep = `a:\n${deep.replace(/^/gm, "  ")}`;
    const outcome = await importText(
      `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\ndata:\n${deep.replace(/^/gm, "  ")}\n`,
    );
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/nested too deeply/) });
  });

  /** `n` Deployments, each with its Service in one of 20 namespaces, each calling the next one by its host. */
  const chain = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `---
apiVersion: apps/v1
kind: Deployment
metadata: { name: svc-${i}, namespace: ns-${i % 20} }
spec:
  template:
    metadata: { labels: { app: svc-${i} } }
    spec: { containers: [{ name: a, image: example/a, env: [{ name: NEXT_URL, value: "http://svc-${(i + 1) % n}.ns-${(i + 1) % 20}" }] }] }
---
apiVersion: v1
kind: Service
metadata: { name: svc-${i}, namespace: ns-${i % 20} }
spec: { selector: { app: svc-${i} } }
`,
    ).join("");

  it("reads documents in linear time", () => {
    // Eight times the workloads, Services and hosts take about eight times as long; matching each host or selector
    // against every workload would take sixty-four. A ratio, not a budget in ms, so a busy machine doesn't fail it.
    // Each text is parsed once, so the ratio is the reader's: the YAML library's linear time would hide it.
    parsed.cache = new Map();
    try {
      const run = (n: number) => {
        const text = chain(n);
        return () => importKubernetes([{ name: "big.yaml", text }]);
      };
      expect(growth(run(125), run(125 * GROWTH_FACTOR), { samples: 3 })).toBeLessThan(LINEAR_LIMIT);
    } finally {
      parsed.cache = undefined;
    }
  }, 30_000);

  it("reads 2,000 documents, and refuses more", () => {
    const docs = chain(1_000);
    const { report } = k8s(docs);
    // Over 300 nodes: the import draws some namespaces, and every one of them drawn is the whole set.
    expect(report.nodes).toBeLessThanOrEqual(300);
    const pick = report.pick!;
    expect(pick.total).toBe(1_000);
    const { diagram } = ok(
      replayOutcome(
        pick.graph,
        pick.format,
        pick.groups.map((g) => g.key),
      ),
    );
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
      // Each variable doubles the one before: unbounded, the fortieth would be 64 × 2^40 characters. Bounded, every
      // value stops at MAX_VALUE (OPAQUE past it), so eight times the chain costs about eight times the work, not
      // 2^35 times. A ratio, not a budget in ms; the size of the result is the bound itself.
      const container = (length: number) => {
        const vars = [`{ name: V0, value: "${"x".repeat(64)}" }`];
        for (let i = 1; i <= length; i++) vars.push(`{ name: V${i}, value: "$(V${i - 1})$(V${i - 1})" }`);
        vars.push(`{ name: DB_URL, value: "http://$(V${length})" }`, '{ name: CACHE_HOST, value: "other" }');
        return pods("api", [`{ name: api, image: example/api, env: [${vars.join(", ")}] }`]) + targets;
      };
      const { diagram, report } = k8s(container(40));
      expect(JSON.stringify([diagram, report]).length).toBeLessThan(50_000);
      // The bounded values don't stop the rest of the container's settings from being read.
      expect(relationBetween(diagram, "api", "other")).toBe("request");
      const run = (length: number) => {
        const text = container(length);
        return () => importKubernetes([{ name: "chain.yaml", text }]);
      };
      expect(growth(run(5), run(5 * GROWTH_FACTOR), { samples: 3 })).toBeLessThan(LINEAR_LIMIT);
    });

    it("budgets ConfigMap settings across workloads, and says so", () => {
      const data = Array.from({ length: 1_000 }, (_, i) => `  K${i}: v${i}`).join("\n");
      const many = Array.from({ length: 500 }, (_, i) =>
        pods(`w${i}`, ["{ name: a, image: example/a, envFrom: [{ configMapRef: { name: big } }] }"]),
      ).join("");
      const { report } = k8s(`apiVersion: v1\nkind: ConfigMap\nmetadata: { name: big }\ndata:\n${data}\n${many}`);
      expect(
        report.notes.map(formatImportMessage).some((n) => n.startsWith("Settings past the first 100,000 weren't read")),
      ).toBe(true);
    });

    it("stops reading a shared ConfigMap once the budget runs out, however many workloads share it", () => {
      // Counted, not timed: every value a container reads from the ConfigMap is one read of its data. 500 workloads
      // sharing 1,000 settings would be 500,000 reads; the budget stops at 100,000, and each container after that
      // gives up at its first setting.
      let reads = 0;
      const data = new Proxy(Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`K${i}`, `v${i}`])), {
        get(target, key, receiver) {
          if (typeof key === "string") reads++;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      const sources = { configMap: () => data, secretKeys: () => undefined };
      const container = { envFrom: [{ configMapRef: { name: "big" } }] };
      const budget = newEnvBudget();
      const envs = Array.from({ length: 500 }, () => containerEnv(container, sources, budget));
      expect(envs.filter(Boolean)).toHaveLength(ENV_LIMITS.maxSettings / 1_000);
      expect(budget.exhausted).toBe(true);
      expect(reads).toBeLessThanOrEqual(ENV_LIMITS.maxSettings + 500);
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
      // Host resolution on its own (WorkloadNames, which the reader asks for every host in every setting), so
      // parsing and the rest of the import can't hide it. A scan of the workloads per host would be quadratic: 8x
      // the workloads and hosts would take 64x as long. Compared against an eighth of the input, not a wall-clock
      // budget, so a slow or busy machine (CI with coverage) doesn't fail it; the fastest of a few runs evens out
      // noise. Unresolved hosts are the worst case: every reading is tried and none is found.
      const resolveAll = (n: number) => {
        const names = new WorkloadNames<{ key: string }>();
        for (let i = 0; i < n; i++) names.add("Deployment", "shop", `w${i}`, { key: `w${i}` });
        const services = new Map<string, string[]>();
        const hosts = Array.from({ length: n * 5 }, (_, i) => `missing-${i}`);
        expect(hosts.filter((h) => names.resolve(h, "shop", services))).toEqual([]);
        expect(names.resolve(`w${n - 1}.shop.svc`, "other", services)).toEqual([`w${n - 1}`]);
        return () => {
          let found = 0;
          for (const h of hosts) if (names.resolve(h, "shop", services)) found++;
          return found;
        };
      };
      expect(growth(resolveAll(1_000), resolveAll(1_000 * GROWTH_FACTOR))).toBeLessThan(LINEAR_LIMIT);
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
    expect(report.notDrawn.map(presentReportLine)).toEqual([
      { name: "Database main", reason: "unknown kind (example.com)" },
    ]);
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
    expect(outcome.report.unread.map(presentReportLine)).toEqual([]);
  });

  it("names the namespace in report rows when two workloads share a name", () => {
    const { report } = k8s(
      deployment("orders", "example/orders:1", "", "staging") +
        deployment("orders", "example/orders:1", "", "production"),
    );
    expect(report.guesses.map((g) => g.label).sort()).toEqual(["orders (production)", "orders (staging)"]);
  });
});
