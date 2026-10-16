// Synthetic infrastructure sources for the import benchmarks and the imported workloads (docs/BENCHMARKS.md §
// Workloads): Kubernetes manifests, a Terraform plan, a compose file and AsyncAPI documents, each made of `units`
// repeated, realistic building blocks (the shapes of tests/fixtures/imports, invented names, no real system). Every
// unit links to its neighbours (hosts, topics, ARNs), so the importers' reference resolution does real work.

import { stringify } from "yaml";
import { rand } from "./common";

export interface SourceFile {
  name: string;
  text: string;
}

// ---------------------------------------------------------------- Kubernetes

type Doc = Record<string, unknown>;

/**
 * `units` apps over up to ten namespaces: each a Deployment behind a Service, with a ConfigMap and a Secret, calling
 * the next app by its cluster host (in chains of five), and publishing to or reading Strimzi KafkaTopics (a KEDA ScaledObject for every
 * third app, a consumer). Each namespace has a PostgreSQL StatefulSet and an Ingress. One file per namespace, as
 * `kubectl get -o yaml` writes it (a `kind: List`), and one for the Kafka cluster and its topics.
 */
export function kubernetesManifests(units: number, seed = 41): SourceFile[] {
  const r = rand(seed);
  const namespaces = Math.min(10, Math.max(1, Math.ceil(units / 8)));
  const ns = (i: number) => `team-${(i % namespaces) + 1}`;
  const meta = (name: string, namespace: string, extra: Doc = {}) => ({ name, namespace, ...extra });
  const lists: Doc[][] = Array.from({ length: namespaces }, (_, k) => [
    {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: meta("postgres", ns(k)),
      spec: {
        serviceName: "postgres",
        replicas: 1,
        selector: { matchLabels: { app: "postgres" } },
        template: {
          metadata: { labels: { app: "postgres" } },
          spec: { containers: [{ name: "postgres", image: "postgres:16", ports: [{ containerPort: 5432 }] }] },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: meta("postgres", ns(k)),
      spec: { clusterIP: "None", selector: { app: "postgres" }, ports: [{ port: 5432 }] },
    },
  ]);
  // Topics live with the Kafka cluster, one per three apps.
  const topics = Math.max(1, Math.ceil(units / 3));
  const kafka: Doc[] = [
    {
      apiVersion: "kafka.strimzi.io/v1beta2",
      kind: "Kafka",
      metadata: meta("events", "kafka"),
      spec: {
        kafka: { replicas: 3, listeners: [{ name: "plain", port: 9092, type: "internal", tls: false }] },
        entityOperator: { topicOperator: {}, userOperator: {} },
      },
    },
    ...Array.from({ length: topics }, (_, t) => ({
      apiVersion: "kafka.strimzi.io/v1beta2",
      kind: "KafkaTopic",
      metadata: meta(`topic-${t + 1}`, "kafka", { labels: { "strimzi.io/cluster": "events" } }),
      spec: { topicName: `events.${t + 1}.v1`, partitions: r.pick([6, 12, 24]), replicas: 3 },
    })),
  ];
  for (let i = 0; i < units; i++) {
    const n = ns(i);
    const app = `app-${i + 1}`;
    // App i publishes to its triple's topic; every third app also reads the previous triple's: chains of topics, five
    // deep (an event chain through every topic would be deeper than any real system's).
    const input = `events.${Math.floor(i / 3)}.v1`;
    const consumer = i % 3 === 1 && Math.floor(i / 3) % 5 !== 0;
    const env = [
      // The next app, in call chains five apps deep (a ring of requests never converges in analysis, and one chain
      // through every app would be deeper than any real system's).
      ...(i + 1 < units && (i + 1) % 5 ? [{ name: "NEXT_URL", value: `http://app-${i + 2}.${ns(i + 1)}.svc` }] : []),
      { name: "DATABASE_HOST", value: `postgres.${n}.svc` },
      { name: "KAFKA_BOOTSTRAP_SERVERS", value: "events-kafka-bootstrap.kafka.svc:9092" },
      { name: "OUTPUT_TOPIC", value: `events.${Math.floor(i / 3) + 1}.v1` },
      ...(consumer
        ? [
            { name: "INPUT_TOPIC", value: input },
            { name: "CONSUMER_GROUP", value: `${app}-group` },
          ]
        : []),
      { name: "API_KEY", valueFrom: { secretKeyRef: { name: `${app}-secrets`, key: "api-key" } } },
    ];
    lists[i % namespaces].push(
      { apiVersion: "v1", kind: "ConfigMap", metadata: meta(`${app}-config`, n), data: { LOG_LEVEL: "info" } },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: meta(`${app}-secrets`, n),
        type: "Opaque",
        data: { "api-key": "cGxhY2Vob2xkZXI=" },
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: meta(app, n, { labels: { app } }),
        spec: {
          replicas: r.int(1, 6),
          selector: { matchLabels: { app } },
          template: {
            metadata: { labels: { app } },
            spec: {
              containers: [
                {
                  name: "main",
                  image: `example.azurecr.io/bench/${app}:1.${i % 10}.0`,
                  ports: [{ containerPort: 8080, name: "http" }],
                  envFrom: [{ configMapRef: { name: `${app}-config` } }],
                  env,
                },
              ],
            },
          },
        },
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: meta(app, n),
        spec: { selector: { app }, ports: [{ name: "http", port: 80, targetPort: "http" }] },
      },
      ...(consumer
        ? [
            {
              apiVersion: "keda.sh/v1alpha1",
              kind: "ScaledObject",
              metadata: meta(app, n),
              spec: {
                scaleTargetRef: { name: app },
                minReplicaCount: 1,
                maxReplicaCount: 12,
                triggers: [
                  {
                    type: "kafka",
                    metadata: {
                      bootstrapServers: "events-kafka-bootstrap.kafka.svc:9092",
                      consumerGroup: `${app}-group`,
                      topic: input,
                      lagThreshold: "50",
                    },
                  },
                ],
              },
            },
          ]
        : []),
    );
  }
  lists.forEach((list, k) =>
    list.push({
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: meta("public", ns(k)),
      spec: {
        rules: [
          {
            host: `${ns(k)}.example.com`,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: `app-${k + 1}`, port: { number: 80 } } },
                },
              ],
            },
          },
        ],
      },
    }),
  );
  const file = (name: string, items: Doc[]) => ({
    name,
    text: stringify({ apiVersion: "v1", kind: "List", items }, { lineWidth: 0 }),
  });
  return [file("kafka.yaml", kafka), ...lists.map((list, k) => file(`${ns(k)}.yaml`, list))];
}

// ---------------------------------------------------------------- Terraform

interface TfResource {
  address: string;
  type: string;
  name: string;
  values: Record<string, unknown>;
  expressions: Record<string, unknown>;
}

/**
 * A `terraform show -json` plan of `units` order-processing slices on AWS: an SNS topic, an SQS queue with its DLQ
 * (redrive), the subscription between them, a Lambda reading the queue through an event source mapping, its role and
 * DynamoDB table, a Secrets Manager secret, and an EventBridge rule for every fourth slice. Each slice's Lambda but the
 * last also publishes to the next slice's topic (an environment reference), so the slices chain.
 */
export function terraformPlan(units: number): SourceFile {
  const resources: TfResource[] = [];
  const ref = (address: string, attr: string) => ({ references: [`${address}.${attr}`, address] });
  const add = (type: string, name: string, values: Record<string, unknown>, expressions: Record<string, unknown>) =>
    resources.push({ address: `${type}.${name}`, type, name, values, expressions });
  for (let i = 0; i < units; i++) {
    const s = `s${i + 1}`;
    // Each slice's handler publishes to the next slice's topic, but the last: a chain, not a ring.
    const next = i + 1 < units ? `s${i + 2}` : undefined;
    add("aws_sns_topic", `${s}_events`, { name: `${s}-events` }, { name: { constant_value: `${s}-events` } });
    add("aws_sqs_queue", `${s}_dlq`, { name: `${s}-dlq` }, { name: { constant_value: `${s}-dlq` } });
    add(
      "aws_sqs_queue",
      `${s}_work`,
      { name: `${s}-work`, visibility_timeout_seconds: 60 },
      { name: { constant_value: `${s}-work` }, redrive_policy: ref(`aws_sqs_queue.${s}_dlq`, "arn") },
    );
    add(
      "aws_sns_topic_subscription",
      `${s}_work`,
      { protocol: "sqs", raw_message_delivery: true },
      {
        protocol: { constant_value: "sqs" },
        topic_arn: ref(`aws_sns_topic.${s}_events`, "arn"),
        endpoint: ref(`aws_sqs_queue.${s}_work`, "arn"),
      },
    );
    add("aws_iam_role", `${s}_handler`, { name: `${s}-handler` }, { name: { constant_value: `${s}-handler` } });
    add(
      "aws_dynamodb_table",
      `${s}_state`,
      { name: `${s}-state`, billing_mode: "PAY_PER_REQUEST" },
      {
        name: { constant_value: `${s}-state` },
      },
    );
    add("aws_secretsmanager_secret", `${s}_api`, { name: `${s}-api` }, { name: { constant_value: `${s}-api` } });
    add(
      "aws_lambda_function",
      `${s}_handler`,
      { function_name: `${s}-handler`, runtime: "python3.12", handler: "app.handler" },
      {
        function_name: { constant_value: `${s}-handler` },
        role: ref(`aws_iam_role.${s}_handler`, "arn"),
        environment: [
          {
            variables: {
              references: [
                `aws_dynamodb_table.${s}_state.name`,
                `aws_dynamodb_table.${s}_state`,
                `aws_secretsmanager_secret.${s}_api.arn`,
                `aws_secretsmanager_secret.${s}_api`,
                ...(next ? [`aws_sns_topic.${next}_events.arn`, `aws_sns_topic.${next}_events`] : []),
              ],
            },
          },
        ],
      },
    );
    add(
      "aws_lambda_event_source_mapping",
      `${s}_work`,
      { batch_size: 10 },
      {
        batch_size: { constant_value: 10 },
        event_source_arn: ref(`aws_sqs_queue.${s}_work`, "arn"),
        function_name: ref(`aws_lambda_function.${s}_handler`, "arn"),
      },
    );
    if (i % 4 === 0) {
      add(
        "aws_cloudwatch_event_rule",
        `${s}_nightly`,
        { schedule_expression: "cron(0 2 * * ? *)" },
        {
          schedule_expression: { constant_value: "cron(0 2 * * ? *)" },
        },
      );
      add(
        "aws_cloudwatch_event_target",
        `${s}_nightly`,
        {},
        {
          rule: ref(`aws_cloudwatch_event_rule.${s}_nightly`, "name"),
          arn: ref(`aws_lambda_function.${s}_handler`, "arn"),
        },
      );
    }
  }
  const plan = {
    format_version: "1.2",
    terraform_version: "1.9.5",
    planned_values: {
      root_module: {
        resources: resources.map((x) => ({
          address: x.address,
          mode: "managed",
          type: x.type,
          name: x.name,
          provider_name: "registry.terraform.io/hashicorp/aws",
          schema_version: 0,
          values: x.values,
          sensitive_values: {},
        })),
      },
    },
    configuration: {
      provider_config: { aws: { name: "aws", full_name: "registry.terraform.io/hashicorp/aws" } },
      root_module: {
        resources: resources.map((x) => ({
          address: x.address,
          mode: "managed",
          type: x.type,
          name: x.name,
          provider_config_key: "aws",
          expressions: x.expressions,
          schema_version: 0,
        })),
      },
    },
  };
  return { name: "plan.json", text: JSON.stringify(plan, null, 2) };
}

// ---------------------------------------------------------------- Compose

/** A compose file of `units` services: workers around Kafka, calling each other in chains of five, a database per ten. */
export function composeFile(units: number): SourceFile {
  const lines = [
    "name: bench",
    "x-kafka-env: &kafka-env",
    "  KAFKA_BOOTSTRAP_SERVERS: kafka:9092",
    "services:",
    "  kafka:",
    "    image: apache/kafka:3.8.0",
    "  gateway:",
    "    image: nginx:1.27-alpine",
    '    ports: ["443:443"]',
    "    depends_on: [svc-1]",
  ];
  const dbs = Math.max(1, Math.ceil(units / 10));
  for (let d = 0; d < dbs; d++)
    lines.push(`  db-${d + 1}:`, "    image: postgres:16", "    environment:", "      POSTGRES_DB: app");
  for (let i = 0; i < units; i++) {
    lines.push(
      `  svc-${i + 1}:`,
      `    image: example/svc-${i + 1}:dev`,
      "    environment:",
      // The shared anchor in the first 50 services only: from about 100 aliases on, the YAML reader refuses the file
      // as a possible alias bomb (src/interop/infra/yaml.ts, maxAliasCount), so a bigger file spells its env out.
      i < 50 ? "      <<: *kafka-env" : "      KAFKA_BOOTSTRAP_SERVERS: kafka:9092",
      ...(i + 1 < units && (i + 1) % 5 ? [`      NEXT_URL: http://svc-${i + 2}:8080`] : []),
      `      DATABASE_URL: postgres://db-${(i % dbs) + 1}:5432/app`,
      `      OUTPUT_TOPIC: events.${Math.floor(i / 3) + 1}`,
      ...(i % 3 === 1 && Math.floor(i / 3) % 5 !== 0
        ? [`      INPUT_TOPIC: events.${Math.floor(i / 3)}`, `      CONSUMER_GROUP: svc-${i + 1}`]
        : []),
      `    depends_on: [kafka, db-${(i % dbs) + 1}]`,
    );
  }
  return { name: "docker-compose.yml", text: lines.join("\n") + "\n" };
}

// ---------------------------------------------------------------- AsyncAPI

/** `units` AsyncAPI 3.0 documents, one application each: it receives one channel and sends to the next (a chain). */
export function asyncApiDocuments(units: number): SourceFile[] {
  return Array.from({ length: units }, (_, i) => {
    const input = `orders.${i + 1}.v1`;
    // The last service's output is a channel nobody receives: a chain, not a ring.
    const output = `orders.${i + 2}.v1`;
    return {
      name: `service-${i + 1}.asyncapi.yaml`,
      text: `asyncapi: 3.0.0
info: { title: Service ${i + 1}, version: 1.0.0 }
servers:
  production: { host: "kafka.bench.internal:9092", protocol: kafka }
channels:
  input:
    address: ${input}
    messages: { Event${i + 1}: { $ref: "#/components/messages/Event${i + 1}" } }
    bindings: { kafka: { partitions: 12, bindingVersion: 0.5.0 } }
  output:
    address: ${output}
    messages: { Event${i + 2}: { $ref: "#/components/messages/Event${i + 2}" } }
operations:
  onInput:
    action: receive
    channel: { $ref: "#/channels/input" }
    bindings: { kafka: { groupId: { type: string, enum: [service-${i + 1}] }, bindingVersion: 0.5.0 } }
  sendOutput:
    action: send
    channel: { $ref: "#/channels/output" }
components:
  messages:
    Event${i + 1}: { name: Event${i + 1}, payload: { type: object, properties: { id: { type: string } } } }
    Event${i + 2}: { name: Event${i + 2}, payload: { type: object } }
`,
    };
  });
}
