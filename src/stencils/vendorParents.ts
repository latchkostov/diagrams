// Behavioural aliases only. Keep vendor descriptions and search data out of model imports.
export const VENDOR_PARENTS: Readonly<Record<string, string>> = {
  fastly: "generic.cdn",
  akamai: "generic.cdn",
  "aws.cloudfront": "generic.cdn",
  "bunny.cdn": "generic.cdn",
  "gcp.cloud-cdn": "generic.cdn",
  "cloudflare.waf": "generic.firewall",
  "aws.waf": "generic.firewall",
  "akamai.app-api-protector": "generic.firewall",
  "imperva.waf": "generic.firewall",
  "sucuri.waf": "generic.firewall",
  "cloudflare.dns": "generic.dns",
  "godaddy.dns": "generic.dns",
  "hostinger.dns": "generic.dns",
  "ionos.dns": "generic.dns",
  "gcp.cloud-dns": "generic.dns",
  "gcp.apigee": "azure.api-management",
  apisix: "kong",
  "activemq.queue": "generic.queue",
  "redpanda.topic": "generic.event-store",
  sqlite: "generic.database",
  mariadb: "generic.database",
  "oracle.database": "generic.database",
  couchbase: "mongodb",
  memcached: "generic.cache",
  valkey: "generic.cache",
  opensearch: "generic.search-index",
  solr: "generic.search-index",
  influxdb: "generic.database",
  timescaledb: "generic.database",
  milvus: "generic.vector-db",
  qdrant: "generic.vector-db",
  weaviate: "generic.vector-db",
  "cloudflare.r2": "generic.file",
  "backblaze.b2": "generic.file",
  wasabi: "generic.file",
  dynatrace: "datadog",
  "elastic.apm": "datadog",
  "grafana.tempo": "jaeger",
  "aws.cognito": "generic.identity-provider",
  "firebase.auth": "generic.identity-provider",
  clerk: "generic.identity-provider",
  square: "generic.external-api",
  braintree: "generic.external-api",
  "aws.ses": "generic.email",
  mailgun: "generic.email",
  postmark: "generic.email",
  onesignal: "generic.push",
  "firebase.fcm": "generic.push",
  launchdarkly: "generic.config-store",
  unleash: "generic.config-store",
  statsig: "generic.config-store",
  "gitlab.ci": "github-actions",
  jenkins: "github-actions",
  circleci: "github-actions",
  "fastly.compute": "cloudflare.workers",
  "google.gemini": "generic.llm",
  "aws.bedrock": "generic.llm",
  "mistral.api": "generic.llm",
};

/** A branded variant uses its category representative's established behaviour. */
export function baseStencilId(id: string): string {
  return Object.hasOwn(VENDOR_PARENTS, id) ? VENDOR_PARENTS[id] : id;
}

/** Reuse translated category wording without borrowing another vendor's name. */
export function vendorDescriptionParent(id: string): string {
  if (id === "fastly.compute") return "azure.functions";
  if (id === "redpanda.topic") return "kafka.topic";
  return baseStencilId(id);
}
