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
  "kafka.cluster": ["broker", "brokers", "confluent"],
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
  "azure.key-vault": ["kv", "akv", "secrets", "keyvault", "kv refs", "key vault references"],
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
  "confluent.cloud": ["cf", "confluent platform", "cp", "kafka", "managed kafka", "ccloud"],
  "kafka.streams": ["kstreams", "streams", "stream processing", "stateful"],
  debezium: ["cdc", "change data capture", "outbox", "binlog", "wal"],
  "pulsar.topic": ["pulsar", "pubsub", "streamnative"],
  "aws.msk": ["msk", "managed kafka", "kafka"],
  "aws.mq": ["activemq", "rabbitmq", "jms", "amqp", "broker"],
  flink: ["stream processing", "streaming", "cep", "windowing"],
  "gcp.dataflow": ["beam", "apache beam", "etl", "pipeline", "google"],
  temporal: ["workflow", "orchestration", "durable execution", "saga", "cadence"],
  camunda: ["bpmn", "workflow", "orchestration", "zeebe", "process"],
  airflow: ["dag", "scheduler", "etl", "orchestration", "mwaa", "composer", "cron"],
  "gcp.cloud-run": ["serverless", "containers", "knative", "google"],
  "gcp.cloud-functions": ["serverless", "function", "faas", "lambda", "google"],
  "gcp.gke": ["kubernetes", "k8s", "cluster", "google"],
  "azure.static-web-apps": ["swa", "static site", "spa", "jamstack", "hosting"],
  vercel: ["nextjs", "next.js", "edge", "frontend", "hosting", "serverless"],
  netlify: ["jamstack", "edge", "frontend", "hosting", "serverless"],
  "cloudflare.workers": ["workers", "edge", "serverless", "cf workers", "durable objects"],
  graphql: ["gql", "apollo", "federation", "schema", "api"],
  grpc: ["protobuf", "rpc", "http2", "proto", "api"],
  "gcp.bigquery": ["bq", "warehouse", "dwh", "analytics", "google"],
  "gcp.spanner": ["newsql", "sql", "google"],
  "gcp.cloud-sql": ["postgres", "mysql", "sql", "google"],
  "gcp.firestore": ["nosql", "document", "firebase", "google"],
  "aws.redshift": ["warehouse", "dwh", "analytics"],
  "aws.aurora": ["rds", "postgres", "mysql", "sql", "serverless"],
  cassandra: ["wide column", "nosql", "scylla", "cql", "keyspaces"],
  clickhouse: ["olap", "analytics", "columnar"],
  supabase: ["postgres", "baas", "auth"],
  firebase: ["baas", "realtime", "fcm", "google"],
  minio: ["s3", "object storage", "bucket", "blob"],
  pinecone: ["vector", "vector db", "embeddings", "rag", "similarity"],
  "azure.data-factory": ["adf", "etl", "elt", "pipeline", "integration"],
  "azure.synapse": ["warehouse", "dwh", "analytics", "spark"],
  "microsoft-fabric": ["fabric", "onelake", "lakehouse", "power bi", "warehouse"],
  envoy: ["proxy", "sidecar", "mesh", "l7"],
  istio: ["mesh", "service mesh", "sidecar", "mtls"],
  linkerd: ["mesh", "service mesh", "mtls"],
  traefik: ["ingress", "reverse proxy", "proxy", "lb"],
  haproxy: ["lb", "load balancer", "proxy", "l4"],
  "generic.cdn": ["edge", "cache", "cloudfront", "akamai", "fastly"],
  "generic.dns": ["route 53", "route53", "domain", "resolver"],
  "generic.firewall": ["waf", "firewall", "security", "shield", "ddos"],
  loki: ["logs", "grafana", "logql"],
  jaeger: ["tracing", "traces", "spans", "distributed tracing"],
  kibana: ["elk", "logs", "dashboards", "elastic"],
  "new-relic": ["newrelic", "nr", "apm", "monitoring"],
  sentry: ["errors", "exceptions", "crash", "apm"],
  okta: ["sso", "oidc", "saml", "identity", "idp", "mfa"],
  auth0: ["oauth", "oidc", "login", "identity", "idp", "ciam"],
  keycloak: ["sso", "oidc", "saml", "identity", "idp", "iam"],
  "client.team": ["users", "people", "group", "team", "ops", "staff"],
  stripe: ["payments", "billing", "checkout", "pay"],
  twilio: ["sms", "voice", "whatsapp", "otp"],
  sendgrid: ["email", "mail", "smtp"],
  salesforce: ["crm", "sfdc"],
  hubspot: ["crm", "marketing"],
  slack: ["chat", "notifications", "alerts", "webhook", "chatops"],
  github: ["git", "webhook", "repo", "gh"],
  openai: ["llm", "gpt", "chatgpt", "ai", "embeddings"],
  "anthropic.claude": ["llm", "claude", "anthropic", "ai"],
  "generic.batch-job": ["batch", "job", "etl", "nightly", "cron job", "worker"],
  "generic.push": ["push", "notification", "apns", "fcm", "mobile"],
  "generic.sms": ["text", "message", "otp", "phone"],
  "generic.file": ["blob", "file", "object", "storage", "s3", "nfs"],
  "generic.warehouse": ["dwh", "olap", "analytics", "bi"],
  "generic.cache": ["cache", "memcached", "in-memory", "kv"],
  "generic.search-index": ["search", "index", "lucene", "opensearch", "full text"],
  "generic.vector-db": ["vector", "embeddings", "pgvector", "weaviate", "qdrant", "milvus", "rag"],
  "generic.ml-model": ["ml", "model", "inference", "ai", "prediction"],
  "generic.llm": ["llm", "ai", "gpt", "claude", "model", "genai"],
  "generic.external-api": ["third party", "3rd party", "external", "api", "rest", "saas"],
  terraform: ["iac", "infrastructure as code", "tf", "hcl", "opentofu"],
  argocd: ["argo", "gitops", "cd", "deploy", "kubernetes"],
  "azure.app-config": ["app config", "appconfig", "appcs", "configuration", "feature flags", "kv refs", "settings"],
  "azure.managed-identity": ["mi", "msi", "workload identity", "user assigned", "system assigned", "identity"],
  "aws.secrets-manager": ["asm", "secrets", "rotation", "credentials"],
  "aws.parameter-store": ["ssm", "systems manager", "parameters", "config", "securestring"],
  "aws.iam-role": ["iam", "role", "irsa", "execution role", "task role", "identity"],
  "gcp.secret-manager": ["secrets", "google"],
  "k8s.configmap": ["configmap", "config map", "cm", "kubernetes", "k8s", "config"],
  "k8s.secret": ["secret", "kubernetes", "k8s", "csi", "external secrets"],
  "generic.config-store": ["config", "configuration", "settings", "feature flags", "consul", "etcd"],
  "generic.secret-store": ["secrets", "vault", "credentials", "kms"],
  "generic.identity-provider": ["idp", "sso", "oauth", "oidc", "saml", "identity", "auth"],
  "aws.cloudwatch": ["logs", "metrics", "alarms", "cw", "monitoring"],
  dbt: ["dbt core", "dbt cloud", "transform", "elt", "models", "marts", "sql"],
  airbyte: ["elt", "etl", "connector", "fivetran", "stitch", "ingestion"],
  "snowflake.snowpipe": ["snowpipe", "streaming ingest", "loader", "kafka connector", "copy into"],
  "generic.reverse-etl": ["reverse etl", "hightouch", "census", "activation", "warehouse sync"],
  "gcp.cloud-storage": ["gcs", "bucket", "object storage", "blob", "google"],
  looker: ["bi", "dashboard", "lookml", "looker studio", "google"],
  tableau: ["bi", "dashboard", "visualization", "reports"],
  "aws.route53": ["route53", "dns", "failover", "latency routing", "global load balancer", "health check"],
  "azure.traffic-manager": ["atm", "dns", "failover", "global load balancer", "geo routing"],
  "gcp.cloud-load-balancing": ["glb", "global load balancer", "anycast", "lb", "google"],
  "generic.event-store": ["event sourcing", "eventstoredb", "kurrent", "append only", "ledger"],
  "generic.projection": ["read model", "cqrs", "projector", "materialized view", "denormalizer"],
  "generic.saga": ["orchestrator", "orchestration", "compensation", "process manager", "workflow"],
  "generic.rate-limiter": ["throttle", "throttling", "token bucket", "quota", "rate limit"],
  "generic.marketing": ["braze", "customer.io", "iterable", "marketo", "campaigns", "crm"],
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
