import { diagnostic, type ImportText } from "./graph";
import { catalog } from "../../stencils/catalog";
import { namedStencil, resolveKind } from "../../ai/stencils";
import type { StencilHint } from "./graph";

// One stencil resolver for every infrastructure source (docs/research/imports.md § Stencils). In order: the
// image table, environment hints for the language, the catalogue by name, then Service. Each answer says how
// sure it is; anything short of "high" is listed in the import report as a guess, with its alternatives.

export type Confidence = "high" | "medium" | "low";

export interface StencilPick {
  id: string;
  confidence: Confidence;
  /** Which step won. */
  step: "image" | "env" | "name" | "fallback";
  alternatives: string[];
  /** The evidence a guess rests on, for the report ("NODE_ENV"). */
  evidence?: string;
}

/** An image that isn't drawn, and why (a fixed string for the report). */
export interface Skip {
  skip: ImportText;
}

const PART_OF_KAFKA = {
  get skip() {
    return diagnostic("importDetail.partOfKafka");
  },
};
const DEV_TOOL = {
  get skip() {
    return diagnostic("importDetail.developerTool");
  },
};

/** Repository (registry and tag removed) → stencil id, or a reason not to draw it. */
const IMAGES: Record<string, string | Skip> = {
  postgres: "postgres",
  "postgis/postgis": "postgres",
  "bitnami/postgresql": "postgres",
  "timescale/timescaledb": "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  "bitnami/mysql": "mysql",
  "bitnami/mariadb": "mysql",
  "mssql/server": "sqlserver",
  "azure-sql-edge": "sqlserver",
  mongo: "mongodb",
  "bitnami/mongodb": "mongodb",
  redis: "redis.cache",
  "bitnami/redis": "redis.cache",
  "redis/redis-stack": "redis.cache",
  "redis/redis-stack-server": "redis.cache",
  "valkey/valkey": "redis.cache",
  memcached: "generic.cache",
  cassandra: "cassandra",
  "scylladb/scylla": "cassandra",
  "clickhouse/clickhouse-server": "clickhouse",
  elasticsearch: "elasticsearch",
  "elasticsearch/elasticsearch": "elasticsearch",
  "opensearchproject/opensearch": "elasticsearch",
  "minio/minio": "minio",
  "azure-storage/azurite": "azure.blob-storage",
  "apache/kafka": "kafka.cluster",
  "bitnami/kafka": "kafka.cluster",
  "confluentinc/cp-kafka": "kafka.cluster",
  "confluentinc/cp-server": "kafka.cluster",
  "redpandadata/redpanda": "kafka.cluster",
  "vectorized/redpanda": "kafka.cluster",
  "confluentinc/cp-schema-registry": "kafka.schema-registry",
  "apicurio/apicurio-registry": "kafka.schema-registry",
  "confluentinc/cp-kafka-connect": "kafka.connect",
  "debezium/connect": "debezium",
  "confluentinc/ksqldb-server": "kafka.ksqldb",
  zookeeper: PART_OF_KAFKA,
  "confluentinc/cp-zookeeper": PART_OF_KAFKA,
  "bitnami/zookeeper": PART_OF_KAFKA,
  rabbitmq: "rabbitmq.queue",
  "bitnami/rabbitmq": "rabbitmq.queue",
  nats: "nats.subject",
  "apachepulsar/pulsar": "pulsar.topic",
  "azure-messaging/servicebus-emulator": "azure.service-bus.queue",
  "eclipse-mosquitto": "mqtt.broker",
  "emqx/emqx": "mqtt.broker",
  "hivemq/hivemq4": "mqtt.broker",
  "hivemq/hivemq-ce": "mqtt.broker",
  nginx: "nginx",
  "nginxinc/nginx-unprivileged": "nginx",
  "bitnami/nginx": "nginx",
  traefik: "traefik",
  haproxy: "haproxy",
  "envoyproxy/envoy": "envoy",
  kong: "kong",
  "kong/kong-gateway": "kong",
  caddy: "load-balancer",
  "prom/prometheus": "prometheus",
  "grafana/grafana": "grafana",
  "grafana/grafana-oss": "grafana",
  "grafana/loki": "loki",
  "hashicorp/vault": "vault",
  "keycloak/keycloak": "keycloak",
  "apache/airflow": "airflow",
  flink: "flink",
  "mailhog/mailhog": "generic.email",
  "axllent/mailpit": "generic.email",
  "provectuslabs/kafka-ui": DEV_TOOL,
  "kafbat/kafka-ui": DEV_TOOL,
  "tchiotludo/akhq": DEV_TOOL,
  "obsidiandynamics/kafdrop": DEV_TOOL,
  "dpage/pgadmin4": DEV_TOOL,
  adminer: DEV_TOOL,
  "localstack/localstack": {
    get skip() {
      return diagnostic("importDetail.emulatesAWSItsServicesArentKnown");
    },
  },
};

/** Whole families by prefix ("jaegertracing/all-in-one", "otel/opentelemetry-collector-contrib"). */
const IMAGE_PREFIXES: [string, string][] = [
  ["jaegertracing/", "jaeger"],
  ["otel/opentelemetry-collector", "opentelemetry"],
  ["temporalio/", "temporal"],
];

/** "ghcr.io/acme/web:4.2@sha256:…" → "acme/web"; "docker.io/library/postgres:16" → "postgres". */
export function repositoryOf(image: string): string {
  let ref = image.trim().toLowerCase().split("@")[0];
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  if (colon > slash) ref = ref.slice(0, colon);
  const parts = ref.split("/");
  // A first part with a dot or a port, or "localhost", is a registry.
  if (parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === "localhost")) parts.shift();
  if (parts[0] === "library" && parts.length > 1) parts.shift();
  return parts.join("/");
}

/** "ghcr.io/acme/storefront:4.2.0" → "storefront:4.2.0": the subtitle keeps the evidence. */
export function shortImage(image: string): string {
  const ref = image.trim().split("@")[0];
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/** The image table's answer: a stencil, a reason not to draw it, or nothing. */
export function imageStencil(image: string | undefined): string | Skip | undefined {
  if (!image) return undefined;
  const repo = repositoryOf(image);
  if (Object.hasOwn(IMAGES, repo)) return IMAGES[repo];
  return IMAGE_PREFIXES.find(([prefix]) => repo.startsWith(prefix))?.[1];
}

/**
 * Settings that name a language. A framework's own prefix (SPRING_, ASPNETCORE_, DJANGO_…) is sure; a
 * general one (NODE_ENV, JAVA_OPTS) is a guess: a web front end sets NODE_ENV too.
 */
const ENV_HINTS: [RegExp, string, Confidence, string[]][] = [
  [/^SPRING_/, "service.java", "high", []],
  [/^ASPNETCORE_/, "service.dotnet", "high", []],
  [/^(DJANGO|FLASK|UVICORN)_/, "service.python", "high", []],
  [/^(JAVA_OPTS|JAVA_TOOL_OPTIONS)$/, "service.java", "medium", ["generic.service"]],
  [/^DOTNET_/, "service.dotnet", "medium", ["generic.service"]],
  [/^NODE_ENV$/, "service.node", "medium", ["client.browser", "generic.service"]],
  [/^(GOMAXPROCS|GODEBUG)$/, "service.go", "medium", ["generic.service"]],
];

const known = new Set(catalog.map((s) => s.id));
const unique = (ids: string[], not: string) =>
  [...new Set(ids)].filter((id) => id !== not && known.has(id)).slice(0, 3);

export function resolveStencil(hint: StencilHint): StencilPick | Skip {
  const byImage = imageStencil(hint.image);
  if (typeof byImage === "object") return byImage;
  if (byImage && known.has(byImage)) return { id: byImage, confidence: "high", step: "image", alternatives: [] };
  for (const name of hint.env ?? []) {
    const rule = ENV_HINTS.find(([re]) => re.test(name));
    if (rule)
      return {
        id: rule[1],
        confidence: rule[2],
        step: "env",
        alternatives: unique(rule[3], rule[1]),
        evidence: rule[0].source.includes("$") ? name : `${name.split("_")[0]}_*`,
      };
  }
  const words = hint.name.replace(/[-_.]+/g, " ");
  const named = namedStencil(words);
  const kind = resolveKind(words);
  if (named === "generic.service")
    // Named by its role ("payments-worker", "orders-api"): a service, and nothing suggests otherwise.
    return { id: named, confidence: "high", step: "name", alternatives: [] };
  if (named)
    return {
      id: named,
      confidence: "medium",
      step: "name",
      alternatives: unique([...kind.alternatives, "generic.service"], named),
    };
  const fallback = hint.fallback && known.has(hint.fallback) ? hint.fallback : "generic.service";
  return {
    id: fallback,
    confidence: "low",
    step: "fallback",
    // An unknown container is often a wrapper around something outside; the catalogue's own suggestions
    // only when it found something.
    alternatives: unique(
      ["generic.service", "generic.external-api", ...(kind.confidence === "low" ? [] : kind.alternatives)],
      fallback,
    ),
  };
}

/**
 * resolveStencil once per component for the whole import: the reader asks for a component's stencil many
 * times (each connection checks both ends), and the mapping asks again for the report's confidence.
 */
const picks = new WeakMap<object, StencilPick | Skip>();
export function pickFor(component: { hint: StencilHint }): StencilPick | Skip {
  let pick = picks.get(component);
  if (!pick) {
    pick = resolveStencil(component.hint);
    picks.set(component, pick);
  }
  return pick;
}

/**
 * A build context or other location as safe text for a subtitle: no URL userinfo (`https://user:token@…`,
 * `token@github.com/…`), no query string and no fragment, which is where tokens ride.
 */
export function withoutCredentials(location: string): string {
  let text = location.trim().replace(/[?#].*$/s, "");
  const scheme = /^[a-z][a-z0-9+.-]{0,15}:\/\//i.exec(text)?.[0] ?? "";
  const rest = text.slice(scheme.length);
  const slash = rest.indexOf("/");
  const at = (slash < 0 ? rest : rest.slice(0, slash)).lastIndexOf("@");
  text = scheme + (at >= 0 ? rest.slice(at + 1) : rest);
  return text;
}
