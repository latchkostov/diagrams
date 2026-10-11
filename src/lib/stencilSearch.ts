import type { Stencil } from "../model/types";
import { categoryLabel } from "./categories";
import { simRoleMeta } from "./simRoles";
import { familyOf, getFamily } from "./vendorFamilies";

/**
 * Stencil search shared by the gallery and the canvas palette. Matches label, vendor, id, sim role,
 * category, family and the alias table below. Every word typed must match something; results are
 * ranked so the obvious hit comes first ("sb" → Service Bus, "pg" → PostgreSQL).
 */

/** Extra words people type for a stencil: abbreviations, old names, generic nouns. */
export const STENCIL_ALIASES: Record<string, readonly string[]> = {
  "kafka.topic": ["log", "event stream", "confluent"],
  "kafka.cluster": ["broker", "brokers", "confluent", "msk"],
  "kafka.connect": ["cdc", "debezium", "connector", "sink", "source"],
  "kafka.schema-registry": ["avro", "protobuf", "schema", "sr"],
  "kafka.ksqldb": ["ksql", "streams", "sql"],
  "azure.service-bus.queue": ["sb", "asb", "servicebus", "dlq", "dead letter"],
  "azure.service-bus.topic": ["sb", "asb", "servicebus", "subscription", "pubsub"],
  "azure.event-hubs": ["eh", "eventhub", "kafka", "stream"],
  "azure.event-grid": ["eg", "events", "pubsub", "webhook"],
  "azure.storage-queue": ["queue storage", "asq"],
  "rabbitmq.exchange": ["amqp", "rmq", "rabbit", "fanout"],
  "rabbitmq.queue": ["amqp", "rmq", "rabbit"],
  "aws.sqs": ["simple queue service", "fifo"],
  "aws.sns": ["simple notification service", "pubsub", "fanout", "notification"],
  "aws.eventbridge": ["cloudwatch events", "event bus", "eb"],
  "aws.kinesis": ["kds", "firehose", "stream"],
  "gcp.pubsub": ["pubsub", "pub sub", "google"],
  "nats.subject": ["jetstream"],
  "redis.stream": ["xadd", "stream"],
  "azure.functions": ["function app", "serverless", "faas", "lambda"],
  "azure.app-service": ["web app", "webapp", "hosting"],
  "azure.container-apps": ["aca", "containers", "keda", "serverless"],
  "azure.aks": ["kubernetes", "k8s", "cluster"],
  "azure.logic-apps": ["workflow", "integration", "low code"],
  "azure.signalr": ["websocket", "realtime", "push"],
  "aws.lambda": ["serverless", "function", "faas"],
  "aws.ecs": ["fargate", "containers"],
  "aws.step-functions": ["sfn", "state machine", "workflow", "orchestration"],
  "k8s.pod": ["kubernetes", "k8s", "container"],
  "k8s.deployment": ["kubernetes", "k8s", "replicaset"],
  "docker.container": ["container", "image"],
  "service.dotnet": ["csharp", "c#", "aspnet", "asp.net", "dotnet", "microservice"],
  "service.java": ["spring", "spring boot", "jvm", "kotlin", "quarkus", "microservice"],
  "service.node": ["nodejs", "javascript", "typescript", "js", "ts", "express", "nest", "microservice"],
  "service.python": ["fastapi", "django", "flask", "py", "microservice"],
  "service.go": ["golang", "microservice"],
  postgres: ["pg", "postgresql", "psql", "rds", "sql"],
  sqlserver: ["mssql", "sql server", "tsql", "sql"],
  "azure.sql": ["mssql", "sql database", "sql"],
  "azure.cosmos-db": ["cosmos", "nosql", "documentdb"],
  "azure.blob-storage": ["blob", "storage account", "object storage", "adls", "s3"],
  "azure.redis": ["cache", "redis"],
  mongodb: ["mongo", "nosql", "document"],
  "redis.cache": ["cache", "kv", "key value", "memcache"],
  elasticsearch: ["es", "elastic", "search", "opensearch", "elk"],
  "aws.s3": ["bucket", "object storage", "blob"],
  "aws.dynamodb": ["dynamo", "ddb", "nosql", "key value"],
  snowflake: ["warehouse", "dwh", "analytics"],
  "adobe.aem": ["aem", "cms", "content"],
  databricks: ["spark", "lakehouse", "delta"],
  "azure.api-management": ["apim", "api gateway", "gateway"],
  "azure.front-door": ["afd", "cdn", "waf", "edge"],
  "azure.app-gateway": ["agw", "appgw", "waf", "l7"],
  "aws.api-gateway": ["apigw", "apigateway", "rest api"],
  "aws.elb": ["alb", "nlb", "load balancer", "lb"],
  nginx: ["ingress", "reverse proxy", "proxy", "lb"],
  kong: ["api gateway", "gateway"],
  cloudflare: ["cdn", "waf", "dns", "workers", "edge"],
  "load-balancer": ["lb", "balancer"],
  grafana: ["dashboard", "dashboards", "loki", "tempo"],
  prometheus: ["metrics", "prom"],
  datadog: ["dd", "apm", "monitoring"],
  "azure.app-insights": ["appinsights", "ai", "azure monitor", "telemetry"],
  opentelemetry: ["otel", "otlp", "tracing", "collector"],
  splunk: ["logs", "siem"],
  "azure.key-vault": ["kv", "akv", "secrets", "keyvault"],
  "entra-id": ["aad", "azure ad", "active directory", "oauth", "oidc", "identity", "sso"],
  vault: ["secrets", "hashicorp"],
  "client.user": ["person", "human", "actor", "customer"],
  "client.browser": ["spa", "web", "frontend", "react"],
  "client.mobile": ["ios", "android", "app", "phone"],
  "client.partner": ["third party", "3rd party", "external", "api"],
  "client.iot": ["device", "sensor", "edge", "telemetry"],
  "generic.service": ["microservice", "api", "app"],
  "generic.database": ["db", "sql", "store"],
  "generic.queue": ["mq", "message queue"],
  "generic.topic": ["pubsub", "pub sub", "events"],
  "generic.scheduler": ["cron", "timer", "job", "batch"],
  "generic.webhook": ["callback", "http", "hook"],
  "generic.email": ["mail", "smtp", "notification", "sendgrid"],
  "github-actions": ["gha", "ci", "cd", "cicd", "pipeline", "github"],
};

interface Indexed {
  stencil: Stencil;
  label: string;
  labelWords: string[];
  /** Lower-cased words from every searchable field. */
  words: string[];
  /** Everything joined, for substring matches. */
  hay: string;
  aliases: string[];
}

const index = new WeakMap<Stencil, Indexed>();

function indexed(s: Stencil): Indexed {
  let hit = index.get(s);
  if (hit) return hit;
  const aliases = (STENCIL_ALIASES[s.id] ?? []).map((a) => a.toLowerCase());
  const fields = [
    s.label,
    s.vendor,
    s.id,
    s.simRole,
    simRoleMeta[s.simRole]?.label ?? "",
    categoryLabel[s.category] ?? s.category,
    getFamily(familyOf(s)).label,
    s.defaultSublabel ?? "",
    ...aliases,
  ].map((f) => f.toLowerCase());
  const hay = fields.join(" ");
  const label = s.label.toLowerCase();
  hit = {
    stencil: s,
    label,
    labelWords: label.split(/[^a-z0-9#+]+/).filter(Boolean),
    words: hay.split(/[^a-z0-9#+]+/).filter(Boolean),
    hay,
    aliases,
  };
  index.set(s, hit);
  return hit;
}

export function tokenize(q: string): string[] {
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Score one token against a stencil; 0 = no match. Short tokens ("sb", "pg") must start a word. */
function scoreToken(ix: Indexed, t: string): number {
  if (ix.label === t || ix.stencil.id === t) return 100;
  if (ix.labelWords.includes(t)) return 85;
  if (ix.aliases.includes(t)) return 80;
  if (ix.label.startsWith(t)) return 70;
  if (ix.words.includes(t)) return 60;
  if (ix.words.some((w) => w.startsWith(t))) return 40;
  if (t.length >= 3 && ix.hay.includes(t)) return 20;
  return 0;
}

/** 0 when the stencil doesn't match the query; higher is a better match. An empty query matches everything (score 1). */
export function scoreStencil(s: Stencil, q: string): number {
  const tokens = tokenize(q);
  if (!tokens.length) return 1;
  const ix = indexed(s);
  let total = 0;
  for (const t of tokens) {
    const sc = scoreToken(ix, t);
    if (!sc) return 0;
    total += sc;
  }
  return total;
}

export function matchesStencil(s: Stencil, q: string): boolean {
  return scoreStencil(s, q) > 0;
}

/** Matching stencils, best first (ties keep catalog order). */
export function searchStencils(list: readonly Stencil[], q: string): Stencil[] {
  return list
    .map((s, i) => ({ s, i, score: scoreStencil(s, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.s);
}
