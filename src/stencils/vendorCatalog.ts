import type { Stencil, StencilCategory } from "../model/types";
import { baseStencilId, vendorDescriptionParent } from "./vendorParents";

// Nominative brands and neutral glyphs; behaviour and translated descriptions follow the parent.
type VendorDef = [id: string, label: string, vendor: string, accent: string, icon?: string, category?: StencilCategory];
const defs: VendorDef[] = [
  ["fastly", "Fastly", "Fastly", "#FF282D"],
  ["akamai", "Akamai CDN", "Akamai", "#009CDE"],
  ["aws.cloudfront", "Amazon CloudFront", "AWS", "#8C4FFF"],
  ["bunny.cdn", "Bunny CDN", "Bunny", "#F47326"],
  ["gcp.cloud-cdn", "Google Cloud CDN", "Google Cloud", "#4285F4"],
  ["cloudflare.waf", "Cloudflare WAF", "Cloudflare", "#F38020"],
  ["aws.waf", "AWS WAF", "AWS", "#DD344C"],
  ["akamai.app-api-protector", "Akamai App & API Protector", "Akamai", "#009CDE"],
  ["imperva.waf", "Imperva WAF", "Imperva", "#0056B8"],
  ["sucuri.waf", "Sucuri WAF", "Sucuri", "#008673"],
  ["cloudflare.dns", "Cloudflare DNS", "Cloudflare", "#F38020"],
  ["godaddy.dns", "GoDaddy DNS", "GoDaddy", "#1BDBDB"],
  ["hostinger.dns", "Hostinger DNS", "Hostinger", "#673DE6"],
  ["ionos.dns", "IONOS DNS", "IONOS", "#003D8F"],
  ["gcp.cloud-dns", "Google Cloud DNS", "Google Cloud", "#4285F4"],
  ["gcp.apigee", "Apigee", "Google Cloud", "#4285F4", "generic-load-balancer"],
  ["apisix", "Apache APISIX", "Apache APISIX", "#E8433E", "generic-load-balancer"],
  ["activemq.queue", "ActiveMQ", "Apache ActiveMQ", "#D22128", "generic-queue", "messaging"],
  ["redpanda.topic", "Redpanda", "Redpanda", "#E53935", "generic-event-store", "messaging"],
  ["sqlite", "SQLite", "SQLite", "#003B57", "generic-database", "data"],
  ["mariadb", "MariaDB", "MariaDB", "#003545", "generic-database", "data"],
  ["oracle.database", "Oracle Database", "Oracle", "#F80000", "generic-database", "data"],
  ["couchbase", "Couchbase", "Couchbase", "#EA2328", "generic-database"],
  ["memcached", "Memcached", "Memcached", "#1E7887", "generic-cache", "data"],
  ["valkey", "Valkey", "Valkey", "#FF6600", "generic-cache", "data"],
  ["opensearch", "OpenSearch", "OpenSearch", "#005EB8", "generic-search-index", "data"],
  ["solr", "Apache Solr", "Apache Solr", "#D9411E", "generic-search-index", "data"],
  ["influxdb", "InfluxDB", "InfluxData", "#22ADF6", "generic-database", "data"],
  ["timescaledb", "TimescaleDB", "TigerData", "#FFC107", "generic-database", "data"],
  ["milvus", "Milvus", "Milvus", "#00A1EA", "generic-vector-db", "data"],
  ["qdrant", "Qdrant", "Qdrant", "#DC244C", "generic-vector-db", "data"],
  ["weaviate", "Weaviate", "Weaviate", "#00A98F", "generic-vector-db", "data"],
  ["cloudflare.r2", "Cloudflare R2", "Cloudflare", "#F38020", "generic-file", "data"],
  ["backblaze.b2", "Backblaze B2", "Backblaze", "#E21E29", "generic-file", "data"],
  ["wasabi", "Wasabi", "Wasabi", "#00CE3E", "generic-file", "data"],
  ["dynatrace", "Dynatrace", "Dynatrace", "#1496FF", "generic-telemetry"],
  ["elastic.apm", "Elastic APM", "Elastic", "#FEC514", "generic-telemetry"],
  ["grafana.tempo", "Grafana Tempo", "Grafana Labs", "#F46800", "generic-telemetry"],
  ["aws.cognito", "Amazon Cognito", "AWS", "#DD344C", "generic-identity-provider", "security"],
  ["firebase.auth", "Firebase Authentication", "Google Cloud", "#FFCA28", "generic-identity-provider", "security"],
  ["clerk", "Clerk", "Clerk", "#6C47FF", "generic-identity-provider", "security"],
  ["square", "Square", "Square", "#006AFF"],
  ["braintree", "Braintree", "PayPal", "#003087"],
  ["aws.ses", "Amazon SES", "AWS", "#DD344C"],
  ["mailgun", "Mailgun", "Mailgun", "#F06B66"],
  ["postmark", "Postmark", "Postmark", "#FFDE00"],
  ["onesignal", "OneSignal", "OneSignal", "#E54B4D"],
  ["firebase.fcm", "Firebase Cloud Messaging", "Google Cloud", "#FFCA28"],
  ["launchdarkly", "LaunchDarkly", "LaunchDarkly", "#405BFF", "generic-config-store", "security"],
  ["unleash", "Unleash", "Unleash", "#817AFE", "generic-config-store", "security"],
  ["statsig", "Statsig", "Statsig", "#3264FF", "generic-config-store", "security"],
  ["gitlab.ci", "GitLab CI/CD", "GitLab", "#FC6D26", "generic-scheduler", "compute"],
  ["jenkins", "Jenkins", "Jenkins", "#D24939", "generic-scheduler", "compute"],
  ["circleci", "CircleCI", "CircleCI", "#343434", "generic-scheduler", "compute"],
  ["fastly.compute", "Fastly Compute", "Fastly", "#FF282D", "generic-service"],
  ["google.gemini", "Google Gemini API", "Google Cloud", "#4285F4"],
  ["aws.bedrock", "Amazon Bedrock", "AWS", "#8C4FFF"],
  ["mistral.api", "Mistral AI API", "Mistral AI", "#FA520F"],
];

export function createVendorStencils(base: readonly Stencil[]): Stencil[] {
  const byId = new Map(base.map((s) => [s.id, s]));
  return defs.map(([id, label, vendor, accent, icon, category]) => {
    const parent = byId.get(baseStencilId(id));
    if (!parent) throw new Error(`Missing vendor stencil parent: ${id}`);
    return {
      ...parent,
      id,
      label,
      vendor,
      accent,
      icon: icon ?? parent.icon,
      category: category ?? parent.category,
      description: byId.get(vendorDescriptionParent(id))!.description,
    };
  });
}
