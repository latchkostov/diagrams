import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { relationOf } from "../../model/relations";
import { estimateCardSize } from "../../canvas/nodes/size";
import { detectFormat, importFiles, importText, type ImportOutcome } from "../formats";
import { sniffInfra } from "../sniff";
import type { ImportReport } from "./graph";
import { importTerraform } from "./pipeline";
import { MAX_RESOURCES, readTerraform, TERRAFORM_BINARY, TERRAFORM_RAW_STATE, TERRAFORM_SOURCE } from "./terraform";
import { configPath, parseRef, TF_LIMITS } from "./tfRefs";
import { notDrawnReason, stencilOf } from "./tfTypes";
import { perfBudget } from "../../test/perfBudget";

// Terraform plan and state JSON (`terraform show -json`) against the self-written fixtures
// (tests/fixtures/imports/terraform), as docs/research/imports.md § Mapping: Terraform describes it: the type
// table, glue resources as flows, references as dependencies, modules and resource groups as boundaries, grants
// as identity and secret relationships, the report, Draw everything, no values out, and hostile input.

const DIR = "tests/fixtures/imports/terraform";
const AWS = { name: "aws-plan.json", text: readFileSync(`${DIR}/aws-plan.json`, "utf8") };
const AZURE = { name: "azure-state.json", text: readFileSync(`${DIR}/azure-state.json`, "utf8") };

function ok(outcome: ImportOutcome): { diagram: DiagramFile; report: ImportReport } {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  if (!outcome.report) throw new Error("no report");
  return { diagram: outcome.diagram, report: outcome.report };
}
const aws = () => ok(importTerraform([AWS]));
const azure = () => ok(importTerraform([AZURE]));
const node = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id);
const edge = (d: DiagramFile, from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to);
const relationBetween = (d: DiagramFile, from: string, to: string) => {
  const e = edge(d, from, to);
  return e && (relationOf(e) === "flow" ? (e.kind === "sync" ? "request" : "message") : relationOf(e));
};
const boundaryOf = (d: DiagramFile, id: string) => d.groups?.find((g) => g.id === node(d, id)?.group)?.label;

interface Res {
  type: string;
  name: string;
  values?: Record<string, unknown>;
  sensitive?: Record<string, unknown>;
  mode?: "data";
  index?: number;
}
/** A state with these resources in its root module (and child modules, by address). */
const state = (resources: Res[], modules: Record<string, Res[]> = {}) =>
  JSON.stringify({
    format_version: "1.0",
    terraform_version: "1.9.5",
    values: {
      root_module: {
        resources: resources.map((r) => resource(r, "")),
        child_modules: Object.entries(modules).map(([address, rs]) => ({
          address,
          resources: rs.map((r) => resource(r, `${address}.`)),
        })),
      },
    },
  });
const resource = (r: Res, prefix: string) => ({
  address: `${prefix}${r.mode ? "data." : ""}${r.type}.${r.name}${r.index === undefined ? "" : `[${r.index}]`}`,
  mode: r.mode ?? "managed",
  type: r.type,
  name: r.name,
  ...(r.index === undefined ? {} : { index: r.index }),
  provider_name: "registry.terraform.io/hashicorp/aws",
  values: r.values ?? {},
  sensitive_values: r.sensitive ?? {},
});
const tf = (text: string, name = "state.json") => ok(importTerraform([{ name, text }]));
const lambdaArn = (n: string, region = "eu-west-1") => `arn:aws:lambda:${region}:123456789012:function:${n}`;
const sqsArn = (n: string) => `arn:aws:sqs:eu-west-1:123456789012:${n}`;

describe("Terraform import: the AWS plan fixture", () => {
  it("is recognised and imports as a Terraform plan", async () => {
    expect(detectFormat(AWS.text, AWS.name)).toBe("terraform");
    const outcome = ok(await importText(AWS.text, AWS.name));
    expect(outcome.report.summary).toBe("Imported “aws-plan” from Terraform plan: 13 nodes, 16 connections.");
    expect(outcome.report.format).toBe("Terraform plan");
  });

  it("draws the components on their stencils, the module as a boundary, instances as one node", () => {
    const { diagram: d } = aws();
    expect(Object.fromEntries(d.nodes.map((n) => [n.id, n.stencil]))).toEqual({
      "order-events": "aws.sns",
      "orders-queue": "aws.sqs",
      "orders-dlq": "aws.sqs",
      "order-handler": "aws.lambda",
      orders: "aws.dynamodb",
      "orders-projector": "aws.lambda",
      "order-handler-role": "aws.iam-role",
      "orders-db-credentials": "aws.secrets-manager",
      "orders-projector-config": "aws.parameter-store",
      "events-msk": "aws.msk",
      analytics: "aws.lambda",
      "nightly-rollup": "generic.scheduler",
      "ext-audit.example.com": "generic.external-api",
    });
    // Labels are the resources' own names; count instances fold into one node, "×2".
    expect(node(d, "orders-db-credentials")?.label).toBe("orders/db-credentials");
    expect(node(d, "analytics")).toMatchObject({ label: "analytics", sublabel: "×2" });
    expect(node(d, "nightly-rollup")?.sublabel).toBe("cron(0 2 * * ? *)");
    // module.streaming is a boundary, AWS-toned; the root module's resources stay loose.
    expect(d.groups?.map((g) => [g.id, g.label, g.tone])).toEqual([
      ["boundary-module.streaming", "module.streaming", "aws"],
    ]);
    expect(boundaryOf(d, "events-msk")).toBe("module.streaming");
    expect(boundaryOf(d, "analytics")).toBe("module.streaming");
    expect(node(d, "order-handler")?.group).toBeUndefined();
  });

  it("draws subscriptions, event-source mappings, targets and redrive policies as flows", () => {
    const { diagram: d } = aws();
    expect(relationBetween(d, "order-events", "orders-queue")).toBe("message");
    expect(relationBetween(d, "orders-queue", "order-handler")).toBe("message");
    expect(relationBetween(d, "orders", "orders-projector")).toBe("message");
    expect(relationBetween(d, "nightly-rollup", "orders-projector")).toBe("message");
    expect(relationBetween(d, "order-events", "ext-audit.example.com")).toBe("message");
    expect(edge(d, "events-msk", "analytics")?.props).toEqual({ group: "orders-analytics" });
    expect(edge(d, "orders-queue", "orders-dlq")?.props).toEqual({ dlq: true });
  });

  it("reads references as dependencies: identity, secret and config by the target, through modules", () => {
    const { diagram: d } = aws();
    expect(relationBetween(d, "order-handler", "order-handler-role")).toBe("identity");
    expect(relationBetween(d, "order-handler", "orders-db-credentials")).toBe("secret");
    expect(relationBetween(d, "orders-projector", "orders-projector-config")).toBe("config");
    expect(relationBetween(d, "order-handler", "orders")).toBe("depends");
    // Out of the module through its output (module.streaming.bootstrap_brokers), and in through its variable.
    expect(relationBetween(d, "order-handler", "events-msk")).toBe("depends");
    expect(relationBetween(d, "analytics", "order-handler-role")).toBe("identity");
    // The role's policy names the secret: everything running as the role gets the secret relationship.
    expect(relationBetween(d, "orders-projector", "orders-db-credentials")).toBe("secret");
    expect(relationBetween(d, "analytics", "orders-db-credentials")).toBe("secret");
    // A flow wins over Depends on for the same pair (the queue's redrive policy names the DLQ).
    expect(d.edges.filter((e) => e.from === "orders-queue" && e.to === "orders-dlq")).toHaveLength(1);
    expect(d.edges).toHaveLength(16);
  });

  it("reports the connections with their resources, what isn't drawn, the plan's changes and a summary", () => {
    const { report } = aws();
    expect(report.connectionsTitle).toBe("Connections from subscriptions, mappings and grants");
    expect(report.inferred.map((c) => `${c.from} → ${c.to} · ${c.evidence}`)).toEqual([
      "nightly-rollup → orders-projector · aws_cloudwatch_event_target.nightly_rollup",
      "order-events → orders-queue · aws_sns_topic_subscription.orders_queue",
      "order-events → audit.example.com · aws_sns_topic_subscription.audit_webhook",
      "orders-queue → order-handler · aws_lambda_event_source_mapping.orders_queue",
      "orders → orders-projector · aws_lambda_event_source_mapping.orders_stream",
      "events-msk → analytics · module.streaming.aws_lambda_event_source_mapping.analytics",
      "orders-queue → orders-dlq · aws_sqs_queue.orders",
      "orders-projector → orders/db-credentials · aws_iam_role_policy.order_handler",
      "analytics → orders/db-credentials · aws_iam_role_policy.order_handler",
    ]);
    expect(report.notDrawn).toEqual([
      { name: "aws_cloudwatch_log_group order_handler", reason: "monitoring" },
      { name: "aws_iam_role_policy_attachment basic_logs", reason: "access and permissions" },
      { name: "aws_kms_key msk", reason: "encryption key" },
      { name: "aws_secretsmanager_secret_version db", reason: "a secret's value: never read" },
      { name: "aws_security_group msk", reason: "networking" },
      { name: "aws_sqs_queue legacy_orders", reason: "destroyed by this plan" },
      { name: "aws_sqs_queue_policy orders", reason: "access and permissions" },
      { name: "random_password db", reason: "helper, not infrastructure" },
    ]);
    expect(report.notes).toEqual([
      "Plan: 28 to add, 0 to change, 1 to destroy",
      "7 supporting resources aren't drawn: access and permissions, parts of what's drawn, monitoring, networking and helpers",
    ]);
    expect(report.guesses).toEqual([]);
    expect(report.unread).toEqual([]);
  });

  it("Draw everything opens the same plan with every resource as a node", () => {
    const { report } = aws();
    const all = ok(report.drawEverything!());
    expect(all.diagram.title).toBe("aws-plan (everything)");
    // Every managed resource in planned_values, count instances folded, plus the outside endpoint.
    expect(all.diagram.nodes).toHaveLength(27);
    expect(node(all.diagram, "msk-brokers")).toMatchObject({
      stencil: "generic.service",
      sublabel: "aws_security_group",
    });
    expect(all.report.drawEverything).toBeUndefined();
    expect(all.report.guesses).toEqual([]);
  });

  it("lays out without overlaps, every member inside its boundary", () => {
    const everything = [aws(), azure()].map(({ report }) => ok(report.drawEverything!()));
    for (const { diagram: d } of [aws(), azure(), ...everything]) {
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
    }
    // Resources with no flows (Draw everything's policies and helpers) pack in a grid, not one tall column.
    for (const { diagram: d } of everything) {
      const xs = d.nodes.map((n) => n.x);
      const ys = d.nodes.map((n) => n.y);
      expect(Math.max(...ys) - Math.min(...ys), d.title).toBeLessThan(3 * (Math.max(...xs) - Math.min(...xs)));
    }
  });

  it("never fetches anything", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await importFiles([AWS, AZURE]);
    await importText(AWS.text, AWS.name);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});

describe("Terraform import: the Azure state fixture", () => {
  it("draws resource groups as boundaries, with Service Bus, Event Grid and Event Hubs flows", () => {
    const { diagram: d, report } = azure();
    expect(report.summary).toBe("Imported “azure-state” from Terraform state: 7 nodes, 7 connections.");
    expect(Object.fromEntries(d.nodes.map((n) => [n.id, [n.stencil, boundaryOf(d, n.id)]]))).toEqual({
      orders: ["azure.service-bus.topic", "rg-billing"],
      "billing-inbox": ["azure.service-bus.queue", "rg-billing"],
      billingfuncstore: ["azure.blob-storage", "rg-billing"],
      "billing-func": ["azure.functions", "rg-billing"],
      "shop-kv": ["azure.key-vault", "rg-shared"],
      "billing-events": ["azure.event-hubs", "rg-billing"],
      "billing-blobs": ["azure.event-grid", "rg-billing"],
    });
    expect(d.groups?.map((g) => g.tone)).toEqual(["azure", "azure"]);
    // The subscription forwards to the queue (its name is the consumer group); Event Grid delivers to the function.
    expect(edge(d, "orders", "billing-inbox")).toMatchObject({ kind: "async", props: { group: "billing" } });
    expect(relationBetween(d, "billingfuncstore", "billing-blobs")).toBe("message");
    expect(relationBetween(d, "billing-blobs", "billing-func")).toBe("message");
    // Role assignments: a receiver reads, a sender writes, a Key Vault role is a secret relationship.
    expect(relationBetween(d, "billing-inbox", "billing-func")).toBe("message");
    expect(relationBetween(d, "billing-func", "billing-events")).toBe("message");
    expect(relationBetween(d, "billing-func", "shop-kv")).toBe("secret");
    expect(relationBetween(d, "billing-func", "billingfuncstore")).toBe("depends");
    expect(report.inferred.find((c) => c.evidence === "azurerm_role_assignment.func_reads_inbox")?.note).toBe(
      "Azure Service Bus Data Receiver",
    );
  });

  it("lists namespaces, plans, groups and secret values as not drawn", () => {
    const { report } = azure();
    expect(report.notDrawn).toEqual([
      { name: "azurerm_resource_group ×2", reason: "not a component" },
      { name: "azurerm_eventhub_consumer_group analytics", reason: "part of Event Hubs" },
      { name: "azurerm_eventhub_namespace telemetry", reason: "shown through its event hubs" },
      { name: "azurerm_key_vault_secret servicebus", reason: "a secret's value: never read" },
      { name: "azurerm_service_plan billing", reason: "hosting plan" },
      { name: "azurerm_servicebus_namespace shop", reason: "shown through its queues and topics" },
    ]);
    expect(report.notes).toEqual(["7 supporting resources aren't drawn: parts of what's drawn"]);
  });
});

describe("Terraform import: values never leave the file", () => {
  const SECRETS = [
    // The AWS plan: a variable, a sensitive output, a sensitive environment variable, a secret version, a random
    // password, a SecureString parameter, and the webhook URL's userinfo and signature.
    "sk_live",
    "hunter2",
    "Rnd-pa55word",
    "ssm-secure-value",
    "hook-token",
    "hooks-user",
    "abc123signature",
    "sig=",
    "123456789012",
    "arn:aws",
    // The Azure state: SAS keys, account keys, a Key Vault secret's value, ids and principals.
    "SharedAccessKey",
    "c2VjcmV0LXNhcy1rZXk",
    "c3RvcmFnZS1hY2NvdW50LWtleQ",
    "AccountKey",
    "kv-secret-value",
    "11111111-2222",
    "aaaaaaaa-0000",
    "99999999-8888",
    "/subscriptions/",
    "azurewebsites.net",
    "vault.azure.net",
  ];

  it("no sensitive value, variable, output, ARN or id reaches the diagram or the report, even drawing everything", () => {
    for (const files of [[AWS], [AZURE], [AWS, AZURE]]) {
      const outcome = importTerraform(files);
      const { diagram, report } = ok(outcome);
      const all = ok(report.drawEverything!());
      const out = JSON.stringify([diagram, report, outcome.ok === true && outcome.warnings, all.diagram, all.report]);
      for (const secret of SECRETS) expect(out, `${files.map((f) => f.name)}: ${secret}`).not.toContain(secret);
    }
  });

  it("never reads an attribute marked sensitive, not even to name or join", () => {
    const { diagram } = tf(
      state([
        // A name marked sensitive isn't used as a label; the resource's own name is.
        {
          type: "aws_sqs_queue",
          name: "q",
          values: { name: "leaky-name", arn: sqsArn("q") },
          sensitive: { name: true },
        },
        { type: "aws_lambda_function", name: "fn", values: { function_name: "fn", arn: lambdaArn("fn") } },
        // The mapping's source is sensitive: it joins nothing.
        {
          type: "aws_lambda_event_source_mapping",
          name: "m",
          values: { event_source_arn: sqsArn("q"), function_name: lambdaArn("fn") },
          sensitive: { event_source_arn: true },
        },
      ]),
    );
    expect(diagram.nodes.map((n) => n.label).sort()).toEqual(["fn", "q"]);
    expect(diagram.edges).toEqual([]);
    expect(JSON.stringify(diagram)).not.toContain("leaky-name");
  });

  it("an outside endpoint shows its host only", () => {
    const { diagram } = tf(
      state([
        { type: "aws_sns_topic", name: "t", values: { name: "t", arn: "arn:aws:sns:eu-west-1:1:t" } },
        {
          type: "aws_sns_topic_subscription",
          name: "s",
          values: {
            topic_arn: "arn:aws:sns:eu-west-1:1:t",
            protocol: "https",
            endpoint: "https://user:p4ss@hooks.partner.example/path?token=t0k3n",
          },
        },
        {
          type: "aws_sns_topic_subscription",
          name: "mail",
          values: { topic_arn: "arn:aws:sns:eu-west-1:1:t", protocol: "email", endpoint: "ops@example.com" },
        },
      ]),
    );
    expect(diagram.nodes.map((n) => n.label)).toEqual(["t", "hooks.partner.example"]);
    const out = JSON.stringify(diagram);
    for (const s of ["p4ss", "t0k3n", "/path", "ops@example.com"]) expect(out).not.toContain(s);
  });
});

describe("Terraform import: glue across services", () => {
  it("EventBridge: a rule on the default bus, a target, and a schedule", () => {
    const { diagram: d } = tf(
      state([
        { type: "aws_lambda_function", name: "fn", values: { function_name: "worker", arn: lambdaArn("worker") } },
        { type: "aws_sqs_queue", name: "q", values: { name: "jobs", arn: sqsArn("jobs") } },
        {
          type: "aws_cloudwatch_event_rule",
          name: "placed",
          values: { name: "order-placed", event_bus_name: "default" },
        },
        { type: "aws_cloudwatch_event_target", name: "t", values: { rule: "order-placed", arn: sqsArn("jobs") } },
        {
          type: "aws_cloudwatch_event_rule",
          name: "tick",
          values: { name: "tick", schedule_expression: "rate(5 minutes)" },
        },
        {
          type: "aws_cloudwatch_event_target",
          name: "t2",
          values: { rule: "tick", arn: `${lambdaArn("worker")}:live` },
        },
        // A rule on a bus that isn't in the file: that bus, by its name, never the default one.
        {
          type: "aws_cloudwatch_event_rule",
          name: "partner",
          values: { name: "partner-orders", event_bus_name: "arn:aws:events:eu-west-1:123456789012:event-bus/partner" },
        },
        { type: "aws_cloudwatch_event_target", name: "t3", values: { rule: "partner-orders", arn: sqsArn("jobs") } },
      ]),
    );
    expect(node(d, "partner")).toMatchObject({ stencil: "aws.eventbridge", sublabel: "not in these files" });
    expect(relationBetween(d, "partner", "jobs")).toBe("message");
    expect(JSON.stringify(d)).not.toContain("123456789012");
    expect(relationBetween(d, "default", "jobs")).toBe("message");
    expect(node(d, "default")).toMatchObject({ stencil: "aws.eventbridge", sublabel: "event bus" });
    // A version or alias ARN names its function.
    expect(relationBetween(d, "tick", "worker")).toBe("message");
    expect(node(d, "tick")).toMatchObject({ stencil: "generic.scheduler", sublabel: "rate(5 minutes)" });
  });

  it("S3 notifications, load balancers through target groups, and API Gateway integrations", () => {
    const lb = "arn:aws:elasticloadbalancing:eu-west-1:1:loadbalancer/app/web/1";
    const tg = "arn:aws:elasticloadbalancing:eu-west-1:1:targetgroup/api/2";
    const { diagram: d } = tf(
      state([
        {
          type: "aws_s3_bucket",
          name: "uploads",
          values: { bucket: "uploads", id: "uploads", arn: "arn:aws:s3:::uploads" },
        },
        { type: "aws_lambda_function", name: "fn", values: { function_name: "thumbs", arn: lambdaArn("thumbs") } },
        {
          type: "aws_s3_bucket_notification",
          name: "n",
          values: { bucket: "uploads", lambda_function: [{ lambda_function_arn: lambdaArn("thumbs") }] },
        },
        { type: "aws_lb", name: "web", values: { name: "web", arn: lb } },
        { type: "aws_lb_target_group", name: "api", values: { name: "api", arn: tg } },
        {
          type: "aws_lb_listener",
          name: "https",
          values: { load_balancer_arn: lb, default_action: [{ type: "forward", target_group_arn: tg }] },
        },
        {
          type: "aws_ecs_service",
          name: "api",
          values: { name: "api", id: "svc-api", load_balancer: [{ target_group_arn: tg }] },
        },
        { type: "aws_apigatewayv2_api", name: "http", values: { name: "public-api", id: "abc123" } },
        {
          type: "aws_apigatewayv2_integration",
          name: "i",
          values: { api_id: "abc123", integration_uri: lambdaArn("thumbs") },
        },
      ]),
    );
    expect(relationBetween(d, "uploads", "thumbs")).toBe("message");
    expect(relationBetween(d, "web", "api")).toBe("request");
    expect(relationBetween(d, "public-api", "thumbs")).toBe("request");
    expect(node(d, "web")?.stencil).toBe("aws.elb");
  });

  it("Pub/Sub: push to Cloud Run, a dead-letter topic, a function's trigger and a scheduler job", () => {
    const { diagram: d } = tf(
      state([
        { type: "google_pubsub_topic", name: "orders", values: { name: "orders", id: "projects/p/topics/orders" } },
        {
          type: "google_pubsub_topic",
          name: "dead",
          values: { name: "orders-dead", id: "projects/p/topics/orders-dead" },
        },
        {
          type: "google_cloud_run_v2_service",
          name: "api",
          values: { name: "orders-api", uri: "https://orders-api-xyz-ew.a.run.app" },
        },
        {
          type: "google_pubsub_subscription",
          name: "push",
          values: {
            name: "orders-push",
            topic: "projects/p/topics/orders",
            push_config: [{ push_endpoint: "https://orders-api-xyz-ew.a.run.app/events?token=abc" }],
            dead_letter_policy: [{ dead_letter_topic: "projects/p/topics/orders-dead" }],
          },
        },
        {
          type: "google_cloudfunctions2_function",
          name: "audit",
          values: { name: "audit", event_trigger: [{ pubsub_topic: "projects/p/topics/orders" }] },
        },
        {
          type: "google_cloud_scheduler_job",
          name: "nightly",
          values: {
            name: "nightly",
            schedule: "0 2 * * *",
            pubsub_target: [{ topic_name: "projects/p/topics/orders" }],
          },
        },
      ]),
    );
    expect(edge(d, "orders", "orders-api")).toMatchObject({ kind: "async", props: { group: "orders-push" } });
    expect(edge(d, "orders", "orders-dead")?.props).toEqual({ dlq: true });
    expect(relationBetween(d, "orders", "audit")).toBe("message");
    expect(relationBetween(d, "nightly", "orders")).toBe("message");
    expect(JSON.stringify(d)).not.toContain("token=abc");
  });

  it("a name that matches more than one resource joins nothing (functions in two regions)", () => {
    const { diagram: d, report } = tf(
      state([
        { type: "aws_sqs_queue", name: "q", values: { name: "jobs", arn: sqsArn("jobs") } },
        { type: "aws_lambda_function", name: "eu", values: { function_name: "handler", arn: lambdaArn("handler") } },
        {
          type: "aws_lambda_function",
          name: "us",
          values: { function_name: "handler", arn: lambdaArn("handler", "us-east-1") },
        },
        {
          type: "aws_lambda_event_source_mapping",
          name: "m",
          values: { event_source_arn: sqsArn("jobs"), function_name: "handler" },
        },
        {
          type: "aws_lambda_event_source_mapping",
          name: "m2",
          values: { event_source_arn: sqsArn("jobs"), function_name: lambdaArn("handler", "us-east-1") },
        },
      ]),
    );
    // The ARN says which one; the bare name doesn't, and is listed rather than guessed.
    expect(d.edges.map((e) => `${e.from}→${e.to}`)).toEqual(["jobs→handler-2"]);
    expect(report.notDrawn).toContainEqual({
      name: "aws_lambda_event_source_mapping m",
      reason: "connects nothing in these files",
    });
  });

  it("databases by engine, data sources, and a component-like type drawn as a guess with chips", () => {
    const { diagram: d, report } = tf(
      state([
        { type: "aws_db_instance", name: "pg", values: { identifier: "orders-db", engine: "postgres" } },
        { type: "aws_rds_cluster", name: "aurora", values: { cluster_identifier: "ledger", engine: "aurora-mysql" } },
        { type: "aws_sqs_queue", name: "legacy", mode: "data", values: { name: "legacy-jobs" } },
        { type: "aws_iam_policy_document", name: "x", mode: "data", values: {} },
        { type: "aws_mwaa_environment", name: "flows", values: { name: "flows" } },
        { type: "aws_batch_compute_environment", name: "batch", values: {} },
        { type: "aws_s3_bucket_versioning", name: "v", values: {} },
        { type: "aws_kinesis_analytics_application", name: "a", values: {} },
        { type: "aws_route53_record", name: "r", values: {} },
      ]),
    );
    expect(node(d, "orders-db")?.stencil).toBe("postgres");
    expect(node(d, "ledger")?.stencil).toBe("aws.aurora");
    expect(node(d, "legacy-jobs")).toMatchObject({ stencil: "aws.sqs", sublabel: "data source" });
    expect(report.notDrawn).toContainEqual({ name: "data.aws_iam_policy_document x", reason: "data source" });
    expect(report.notDrawn).toContainEqual({ name: "aws_s3_bucket_versioning v", reason: "part of aws_s3_bucket" });
    expect(report.notDrawn).toContainEqual({ name: "aws_route53_record r", reason: "networking" });
    expect(report.notDrawn).toContainEqual({
      name: "aws_batch_compute_environment batch",
      reason: "Terraform type not drawn",
    });
    // "_application" isn't a component word; "_environment" neither: listed. Nothing is dropped silently.
    expect(report.notDrawn.map((r) => r.name)).toContain("aws_kinesis_analytics_application a");
    expect(report.notDrawn.map((r) => r.name)).toContain("aws_mwaa_environment flows");
    expect(report.guesses).toEqual([]);
    const guessed = tf(state([{ type: "aws_opensearchserverless_collection_instance", name: "s", values: {} }]));
    expect(guessed.report.guesses).toEqual([
      {
        nodeId: "s",
        label: "s",
        stencil: "generic.service",
        evidence: "aws_opensearchserverless_collection_instance",
        alternatives: ["generic.database", "generic.external-api"],
      },
    ]);
  });

  it("joins two states on ARNs, each file's resources its own", () => {
    const a = state([{ type: "aws_sqs_queue", name: "q", values: { name: "jobs", arn: sqsArn("jobs") } }]);
    const b = state([
      { type: "aws_sqs_queue", name: "q", values: { name: "jobs-b", arn: sqsArn("jobs-b") } },
      { type: "aws_lambda_function", name: "fn", values: { function_name: "worker", arn: lambdaArn("worker") } },
      {
        type: "aws_lambda_event_source_mapping",
        name: "m",
        values: { event_source_arn: sqsArn("jobs"), function_name: lambdaArn("worker") },
      },
    ]);
    const { diagram: d, report } = ok(
      importTerraform([
        { name: "shared.json", text: a },
        { name: "app.json", text: b },
      ]),
    );
    expect(d.title).toBe("Terraform state");
    expect(d.nodes.map((n) => n.label)).toEqual(["jobs", "jobs-b", "worker"]);
    expect(relationBetween(d, "jobs", "worker")).toBe("message");
    expect(report.source).toBe("shared.json, app.json");
  });
});

describe("Terraform import: what isn't Terraform JSON says what to run", () => {
  it(".tf source, a binary plan and a raw state file each get one sentence", async () => {
    const hcl = 'resource "aws_sqs_queue" "orders" {\n  name = "orders"\n}\n';
    expect(sniffInfra(hcl)).toBe("hcl");
    expect(await importText(hcl, "main.tf")).toEqual({ ok: false, error: TERRAFORM_SOURCE });
    expect(await importText(hcl)).toEqual({ ok: false, error: TERRAFORM_SOURCE });
    // A .tf file that starts with comments is still known by its name.
    expect(await importText("# just variables\n\n# more\n", "variables.tf")).toEqual({
      ok: false,
      error: TERRAFORM_SOURCE,
    });
    expect(TERRAFORM_SOURCE).toBe(
      "Terraform source (.tf) isn't read. Run “terraform show -json plan.out” (or state) and import that.",
    );
    expect(await importText("PK\u0003\u0004\u0014\u0000tfplan\u0000\u0000binary", "plan.out")).toEqual({
      ok: false,
      error: TERRAFORM_BINARY,
    });
    const raw = JSON.stringify({ version: 4, terraform_version: "1.9.5", serial: 3, lineage: "x", resources: [] });
    expect(await importText(raw, "terraform.tfstate")).toEqual({ ok: false, error: TERRAFORM_RAW_STATE });
    // Among other files, Terraform source is listed with the same hint.
    const outcome = ok(await importFiles([AWS, { name: "main.tf", text: hcl }]));
    expect(outcome.report.unread).toContainEqual({
      name: "main.tf",
      reason: "Terraform source: import “terraform show -json” output instead",
    });
    // YAML that happens to have `data:` or `module:` keys is never taken for HCL.
    expect(sniffInfra("data: { a: 1 }\nmodule: x\n")).toBeUndefined();
  });

  it("refuses other format versions and invalid JSON plainly", async () => {
    expect(await importText('{"format_version":"2.0","terraform_version":"2.0.0","values":{}}', "p.json")).toEqual({
      ok: false,
      error: "p.json is Terraform JSON format 2.0; only format 1 is read.",
    });
    expect(await importText('{"format_version":"1.0","terraform_version":"1.9", ', "p.json")).toEqual({
      ok: false,
      error: "p.json isn't valid JSON, so it wasn't read.",
    });
  });

  it("recognises Terraform JSON in any key order, anywhere in the text", () => {
    const resources = Array.from({ length: 80 }, (_, i) => ({
      address: `aws_sqs_queue.q${i}`,
      mode: "managed",
      type: "aws_sqs_queue",
      name: `q${i}`,
      values: { name: `queue-${i}` },
    }));
    // `jq -S` sorts keys: format_version and terraform_version come after a long configuration.
    const sorted = JSON.stringify({
      configuration: { root_module: { resources: resources.map((r) => ({ ...r, expressions: {} })) } },
      format_version: "1.2",
      planned_values: { root_module: { resources } },
      terraform_version: "1.9.5",
    });
    expect(sorted.indexOf('"format_version"')).toBeGreaterThan(4_000);
    expect(detectFormat(sorted, "plan.json")).toBe("terraform");
    expect(tf(sorted, "plan.json").diagram.nodes).toHaveLength(80);
    // A plan that manages Kubernetes objects mentions apiVersion and kind: still Terraform.
    const k8sPlan = JSON.stringify({
      format_version: "1.2",
      terraform_version: "1.9.5",
      planned_values: {
        root_module: {
          resources: [
            {
              address: "kubernetes_manifest.cm",
              type: "kubernetes_manifest",
              name: "cm",
              values: { manifest: { apiVersion: "v1", kind: "ConfigMap" } },
            },
          ],
        },
      },
    });
    expect(detectFormat(k8sPlan)).toBe("terraform");
    // And a Kubernetes object stays Kubernetes, even one whose data mentions Terraform's keys.
    const cm = JSON.stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "x" },
      data: { "plan.json": '{"format_version":"1.2","terraform_version":"1.9"}' },
    });
    expect(detectFormat(cm)).toBe("kubernetes");
  });
});

describe("Terraform import: hostile input", () => {
  it("reads a 10,000-resource state within budget, and refuses more", () => {
    const resources: Res[] = [];
    for (let i = 0; i < 2_500; i++) {
      resources.push(
        { type: "aws_sqs_queue", name: `q${i}`, values: { name: `jobs-${i}`, arn: sqsArn(`jobs-${i}`) } },
        {
          type: "aws_lambda_function",
          name: `fn${i}`,
          values: { function_name: `fn-${i}`, arn: lambdaArn(`fn-${i}`) },
        },
        {
          type: "aws_lambda_event_source_mapping",
          name: `m${i}`,
          values: { event_source_arn: sqsArn(`jobs-${i}`), function_name: lambdaArn(`fn-${i}`) },
        },
        { type: "aws_iam_role_policy_attachment", name: `a${i}`, values: { role: "shared" } },
      );
    }
    const text = state(resources);
    const started = performance.now();
    const { diagram, report } = tf(text);
    expect(performance.now() - started).toBeLessThan(perfBudget(6_000));
    expect(diagram.nodes).toHaveLength(5_000);
    expect(diagram.edges).toHaveLength(2_500);
    expect(report.notDrawn).toEqual([
      { name: "aws_iam_role_policy_attachment ×2,500", reason: "access and permissions" },
    ]);
    expect(report.inferred.length).toBeLessThanOrEqual(200);
    expect(report.notes).toContain("2,300 more connections like these aren't listed");
    const more = state([...resources, { type: "aws_sqs_queue", name: "one_too_many", values: {} }]);
    expect(() => importTerraform([{ name: "big.json", text: more }])).toThrow(/more than 10,000 resources/);
    expect(MAX_RESOURCES).toBe(10_000);
  });

  it("stops at deeply nested modules, in values and in configuration, and says so", () => {
    let values: Record<string, unknown> = {
      resources: [resource({ type: "aws_sqs_queue", name: "deep", values: { name: "deep" } }, "")],
    };
    let config: Record<string, unknown> = { resources: [] };
    let address = "";
    const depth = 60;
    for (let i = depth; i > 0; i--) {
      values = { address: `module.m${i}`, resources: [], child_modules: [values] };
      config = { resources: [], module_calls: { [`m${i}`]: { module: config } } };
    }
    for (let i = 1; i <= depth; i++) address += `${i > 1 ? "." : ""}module.m${i}`;
    // Child addresses are full paths: rebuild them from the top.
    const fix = (m: Record<string, unknown>, path: string, i: number): Record<string, unknown> => ({
      ...m,
      ...(i ? { address: path } : {}),
      child_modules: ((m.child_modules as Record<string, unknown>[]) ?? []).map((c) =>
        fix(c, `${path ? `${path}.` : ""}module.m${i + 1}`, i + 1),
      ),
    });
    const text = JSON.stringify({
      format_version: "1.2",
      terraform_version: "1.9.5",
      planned_values: {
        root_module: {
          resources: [resource({ type: "aws_sns_topic", name: "top", values: { name: "top" } }, "")],
          child_modules: [fix(values, "module.m1", 1)],
        },
      },
      configuration: { root_module: { module_calls: { m1: { module: config } } } },
    });
    expect(address.length).toBeGreaterThan(0);
    const started = performance.now();
    const { diagram, report } = tf(text, "deep.json");
    expect(performance.now() - started).toBeLessThan(perfBudget(1_000));
    expect(diagram.nodes.map((n) => n.label)).toEqual(["top"]);
    expect(report.unread.length).toBeGreaterThan(0);
    expect(report.unread[0].reason).toBe(`modules nested more than ${TF_LIMITS.maxModuleDepth} deep aren't read`);
  });

  it("follows references through modules, stopping where they go round in a circle", () => {
    // module.a's output is its variable, which root sets from module.a's output: a cycle. And a long chain of
    // modules each passing the previous one's output on.
    const chain = 1_000;
    const calls: Record<string, unknown> = {
      a: {
        expressions: { v: { references: ["module.a.out", "module.a"] } },
        module: { outputs: { out: { expression: { references: ["var.v"] } } }, resources: [] },
      },
    };
    for (let i = 0; i < chain; i++)
      calls[`c${i}`] = {
        expressions: { v: { references: [i ? `module.c${i - 1}.out` : "aws_sqs_queue.q"] } },
        module: { outputs: { out: { expression: { references: ["var.v"] } } }, resources: [] },
      };
    const text = JSON.stringify({
      format_version: "1.2",
      terraform_version: "1.9.5",
      planned_values: {
        root_module: {
          resources: [
            resource({ type: "aws_sqs_queue", name: "q", values: { name: "jobs" } }, ""),
            resource({ type: "aws_lambda_function", name: "fn", values: { function_name: "worker" } }, ""),
            resource({ type: "aws_lambda_function", name: "loop", values: { function_name: "loop" } }, ""),
          ],
        },
      },
      configuration: {
        root_module: {
          resources: [
            { address: "aws_sqs_queue.q", type: "aws_sqs_queue", name: "q", expressions: {} },
            {
              address: "aws_lambda_function.fn",
              type: "aws_lambda_function",
              name: "fn",
              expressions: { environment: [{ variables: { references: [`module.c${chain - 1}.out`] } }] },
            },
            {
              address: "aws_lambda_function.loop",
              type: "aws_lambda_function",
              name: "loop",
              expressions: { environment: [{ variables: { references: ["module.a.out"] } }] },
            },
          ],
          module_calls: calls,
        },
      },
    });
    const started = performance.now();
    const { diagram, report } = tf(text, "chain.json");
    expect(performance.now() - started).toBeLessThan(perfBudget(2_000));
    expect(relationBetween(diagram, "loop", "jobs")).toBeUndefined();
    expect(diagram.edges.filter((e) => e.from === "loop")).toEqual([]);
    // The chain is longer than the resolver follows: it stops, and the report says so.
    expect(report.notes).toContain("Some references weren't followed: the plan holds too many to read them all");
  });

  it("keeps __proto__ and constructor as plain names, and never pollutes prototypes", () => {
    // Written as text: an object literal's __proto__ would set its prototype rather than make a key.
    const text = `{"format_version":"1.0","terraform_version":"1.9.5","__proto__":{"polluted":"yes"},
      "values":{"root_module":{"resources":[
        {"type":"aws_sqs_queue","name":"constructor","values":{"name":"__proto__","__proto__":{"polluted":1}}},
        {"type":"aws_sns_topic","name":"__proto__","values":{"constructor":"x"}}]}}}`;
    const { diagram } = tf(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(diagram.nodes.map((n) => n.label).sort()).toEqual(["__proto__", "__proto__"]);
  });

  it("runs its own patterns in linear time on adversarial input", () => {
    for (const evil of [
      "[".repeat(100_000),
      '["'.repeat(50_000),
      "module.".repeat(30_000),
      "a.".repeat(50_000),
      '"terraform_version":'.repeat(10_000),
      'resource "a" '.repeat(10_000),
    ]) {
      const started = performance.now();
      configPath(evil);
      parseRef(evil);
      sniffInfra(`{${evil}`);
      sniffInfra(evil);
      notDrawnReason(evil.slice(0, 4_000));
      stencilOf(evil);
      expect(performance.now() - started, evil.slice(0, 12)).toBeLessThan(perfBudget(250));
    }
  });

  it("deep JSON in a value is never walked", () => {
    const deep = `${"[".repeat(200_000)}${"]".repeat(200_000)}`;
    const text = `{"format_version":"1.0","terraform_version":"1.9.5","values":{"root_module":{"resources":[{"type":"aws_sqs_queue","name":"q","values":{"name":"jobs","tags":${deep}}}]}}}`;
    const started = performance.now();
    expect(readTerraform([{ name: "deep.json", text }]).components.map((c) => c.label)).toEqual(["jobs"]);
    expect(performance.now() - started).toBeLessThan(perfBudget(1_000));
  });
});

describe("Terraform type table", () => {
  it("maps every type the plan names to a stencil in the catalogue", async () => {
    const { getStencil } = await import("../../stencils/registry");
    for (const [type, stencil] of [
      ["aws_sqs_queue", "aws.sqs"],
      ["aws_sns_topic", "aws.sns"],
      ["aws_lambda_function", "aws.lambda"],
      ["aws_dynamodb_table", "aws.dynamodb"],
      ["aws_msk_cluster", "aws.msk"],
      ["aws_kinesis_stream", "aws.kinesis"],
      ["aws_mq_broker", "aws.mq"],
      ["aws_cloudwatch_event_bus", "aws.eventbridge"],
      ["aws_ecs_service", "aws.ecs"],
      ["aws_sfn_state_machine", "aws.step-functions"],
      ["aws_lb", "aws.elb"],
      ["aws_api_gateway_rest_api", "aws.api-gateway"],
      ["aws_s3_bucket", "aws.s3"],
      ["aws_elasticache_replication_group", "redis.cache"],
      ["aws_secretsmanager_secret", "aws.secrets-manager"],
      ["aws_ssm_parameter", "aws.parameter-store"],
      ["aws_iam_role", "aws.iam-role"],
      ["aws_cloudfront_distribution", "generic.cdn"],
      ["aws_wafv2_web_acl", "generic.firewall"],
      ["azurerm_servicebus_queue", "azure.service-bus.queue"],
      ["azurerm_servicebus_topic", "azure.service-bus.topic"],
      ["azurerm_eventhub", "azure.event-hubs"],
      ["azurerm_eventgrid_topic", "azure.event-grid"],
      ["azurerm_eventgrid_system_topic", "azure.event-grid"],
      ["azurerm_storage_queue", "azure.storage-queue"],
      ["azurerm_function_app", "azure.functions"],
      ["azurerm_linux_function_app", "azure.functions"],
      ["azurerm_windows_function_app", "azure.functions"],
      ["azurerm_linux_web_app", "azure.app-service"],
      ["azurerm_container_app", "azure.container-apps"],
      ["azurerm_kubernetes_cluster", "azure.aks"],
      ["azurerm_mssql_database", "azure.sql"],
      ["azurerm_postgresql_flexible_server", "postgres"],
      ["azurerm_cosmosdb_account", "azure.cosmos-db"],
      ["azurerm_redis_cache", "azure.redis"],
      ["azurerm_managed_redis", "azure.redis"],
      ["azurerm_storage_account", "azure.blob-storage"],
      ["azurerm_key_vault", "azure.key-vault"],
      ["azurerm_app_configuration", "azure.app-config"],
      ["azurerm_user_assigned_identity", "azure.managed-identity"],
      ["azurerm_api_management", "azure.api-management"],
      ["azurerm_cdn_frontdoor_profile", "azure.front-door"],
      ["azurerm_application_gateway", "azure.app-gateway"],
      ["azurerm_application_insights", "azure.app-insights"],
      ["google_pubsub_topic", "gcp.pubsub"],
      ["google_cloud_run_service", "gcp.cloud-run"],
      ["google_cloud_run_v2_service", "gcp.cloud-run"],
      ["google_cloudfunctions2_function", "gcp.cloud-functions"],
      ["google_container_cluster", "gcp.gke"],
      ["google_dataflow_job", "gcp.dataflow"],
      ["google_sql_database_instance", "gcp.cloud-sql"],
      ["google_spanner_instance", "gcp.spanner"],
      ["google_bigquery_dataset", "gcp.bigquery"],
      ["google_storage_bucket", "gcp.cloud-storage"],
      ["google_firestore_database", "gcp.firestore"],
      ["google_secret_manager_secret", "gcp.secret-manager"],
      ["confluent_kafka_topic", "kafka.topic"],
      ["kafka_topic", "kafka.topic"],
    ]) {
      expect(stencilOf(type), type).toBe(stencil);
      expect(getStencil(stencil).id, stencil).toBe(stencil);
    }
    expect(stencilOf("aws_db_instance", "sqlserver-ex")).toBe("sqlserver");
    expect(stencilOf("aws_db_instance", "oracle-ee")).toBe("generic.database");
  });

  it("gives every supporting type a reason", () => {
    for (const [type, reason] of [
      ["aws_iam_policy", "access and permissions"],
      ["aws_lambda_permission", "access and permissions"],
      ["azurerm_role_assignment", "access and permissions"],
      ["random_password", "helper, not infrastructure"],
      ["null_resource", "helper, not infrastructure"],
      ["time_sleep", "helper, not infrastructure"],
      ["tls_private_key", "helper, not infrastructure"],
      ["aws_vpc", "networking"],
      ["aws_subnet", "networking"],
      ["azurerm_virtual_network", "networking"],
      ["aws_cloudwatch_metric_alarm", "monitoring"],
      ["aws_api_gateway_stage", "part of API Gateway"],
      ["aws_lambda_function_url", "part of aws_lambda_function"],
      ["aws_ecs_cluster", "shown through its services"],
      ["google_project_service", "an enabled API"],
    ])
      expect(notDrawnReason(type), type).toBe(reason);
    expect(notDrawnReason("aws_instance")).toBeUndefined();
  });

  it("parses references and configuration paths without evaluating anything", () => {
    expect(configPath('module.a["x.y"].module.b[0]')).toBe("module.a.module.b");
    expect(parseRef("aws_sqs_queue.orders[0].arn")).toEqual({ kind: "resource", address: "aws_sqs_queue.orders" });
    expect(parseRef('data.aws_iam_policy_document.x["k"].json')).toEqual({
      kind: "resource",
      address: "data.aws_iam_policy_document.x",
    });
    expect(parseRef("module.streaming.bootstrap_brokers")).toEqual({
      kind: "module",
      name: "streaming",
      output: "bootstrap_brokers",
    });
    expect(parseRef("var.lambda_role_arn")).toEqual({ kind: "var", name: "lambda_role_arn" });
    for (const r of ["local.x", "each.value", "count.index", "path.module", "self.arn", "terraform.workspace", "x"])
      expect(parseRef(r), r).toBeUndefined();
  });
});
