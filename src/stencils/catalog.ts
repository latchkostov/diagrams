import type { SimRole, Stencil, StencilCategory } from "../model/types";

// The stencil catalog. Icons live in ./icons/<icon>.svg — sources & licenses in docs/ICONS.md.
// Ids are persisted in saved diagrams: never rename one once shipped.

type Def = [
  id: string,
  label: string,
  vendor: string,
  icon: string,
  accent: string,
  simRole: SimRole,
  description: string,
  defaultSublabel?: string,
];

function group(category: StencilCategory, defs: Def[]): Stencil[] {
  return defs.map(([id, label, vendor, icon, accent, simRole, description, defaultSublabel]) => ({
    id,
    label,
    category,
    vendor,
    icon,
    accent,
    simRole,
    description,
    ...(defaultSublabel ? { defaultSublabel } : {}),
  }));
}

// Shared brand accents.
const KAFKA = "#7C3AED"; // Kafka's mark is near-black; use a vivid violet so nodes/particles read on light & dark.
const AZURE = "#0078D4";
const AWS_INTEGRATION = "#E7157B";
const AWS_ANALYTICS_NET = "#8C4FFF";
const AWS_COMPUTE = "#ED7100";
const REDIS = "#DC382D";

const messaging = group("messaging", [
  ["kafka.topic", "Kafka Topic", "Apache Kafka", "kafka", KAFKA, "topic", "Partitioned, replicated log; every consumer group gets every record.", "topic"],
  ["kafka.cluster", "Kafka Cluster", "Apache Kafka", "kafka", KAFKA, "none", "A set of Kafka brokers hosting topics and partitions.", "cluster"],
  ["kafka.connect", "Kafka Connect", "Apache Kafka", "kafka", KAFKA, "processor", "Source/sink connectors streaming data between Kafka and external systems.", "connector"],
  ["kafka.schema-registry", "Schema Registry", "Apache Kafka", "kafka", KAFKA, "none", "Central store of Avro/Protobuf/JSON schemas for Kafka topics.", "schemas"],
  ["kafka.ksqldb", "ksqlDB", "Apache Kafka", "kafka", KAFKA, "processor", "Streaming SQL engine for filtering, joining and aggregating Kafka topics.", "stream processor"],
  ["azure.service-bus.queue", "Service Bus Queue", "Azure", "azure-service-bus", AZURE, "queue", "Durable point-to-point queue with sessions, DLQ and competing consumers.", "queue"],
  ["azure.service-bus.topic", "Service Bus Topic", "Azure", "azure-service-bus", AZURE, "topic", "Pub/sub topic; each subscription receives its own copy of every message.", "topic"],
  ["azure.event-hubs", "Event Hubs", "Azure", "azure-event-hubs", "#5EA02E", "stream", "Partitioned big-data event streaming service (Kafka-compatible).", "event hub"],
  ["azure.event-grid", "Event Grid", "Azure", "azure-event-grid", "#3E8E2A", "topic", "Serverless event routing with push delivery and filtering.", "topic"],
  ["azure.storage-queue", "Storage Queue", "Azure", "azure-storage-queue", "#8452E3", "queue", "Simple, cheap queue in an Azure Storage account.", "queue"],
  ["rabbitmq.exchange", "RabbitMQ Exchange", "RabbitMQ", "rabbitmq", "#FF6600", "topic", "Routes messages to bound queues (direct, topic, fanout, headers).", "exchange"],
  ["rabbitmq.queue", "RabbitMQ Queue", "RabbitMQ", "rabbitmq", "#FF6600", "queue", "Buffers messages for competing consumers.", "queue"],
  ["aws.sqs", "Amazon SQS", "AWS", "aws-sqs", AWS_INTEGRATION, "queue", "Fully managed message queue (standard or FIFO).", "queue"],
  ["aws.sns", "Amazon SNS", "AWS", "aws-sns", AWS_INTEGRATION, "topic", "Pub/sub fan-out to SQS, Lambda, HTTP, email and SMS.", "topic"],
  ["aws.eventbridge", "Amazon EventBridge", "AWS", "aws-eventbridge", AWS_INTEGRATION, "topic", "Serverless event bus with rule-based routing.", "event bus"],
  ["aws.kinesis", "Kinesis Data Streams", "AWS", "aws-kinesis", AWS_ANALYTICS_NET, "stream", "Sharded real-time data stream.", "stream"],
  ["gcp.pubsub", "Pub/Sub", "Google Cloud", "gcp-pubsub", "#4285F4", "topic", "Global managed pub/sub messaging.", "topic"],
  ["nats.subject", "NATS Subject", "NATS", "nats", "#27AAE1", "topic", "Lightweight subject-based pub/sub (optionally persisted with JetStream).", "subject"],
  ["redis.stream", "Redis Stream", "Redis", "redis", REDIS, "stream", "Append-only log with consumer groups inside Redis.", "stream"],
]);

const compute = group("compute", [
  ["azure.functions", "Azure Functions", "Azure", "azure-functions", "#E8A80C", "processor", "Event-driven serverless functions.", "function"],
  ["azure.app-service", "App Service", "Azure", "azure-app-service", "#2F7FE3", "processor", "Managed hosting for web apps and APIs."],
  ["azure.container-apps", "Container Apps", "Azure", "azure-container-apps", "#9061F0", "processor", "Serverless containers with KEDA-based autoscaling.", "container app"],
  ["azure.aks", "AKS", "Azure", "azure-aks", "#7C4DDB", "processor", "Azure Kubernetes Service — managed Kubernetes clusters.", "cluster"],
  ["azure.logic-apps", "Logic Apps", "Azure", "azure-logic-apps", "#5DA82A", "processor", "Low-code workflows and integrations with hundreds of connectors.", "workflow"],
  ["azure.signalr", "SignalR Service", "Azure", "azure-signalr", AZURE, "gateway", "Managed real-time WebSocket messaging to clients."],
  ["aws.lambda", "AWS Lambda", "AWS", "aws-lambda", AWS_COMPUTE, "processor", "Serverless functions triggered by events.", "function"],
  ["aws.ecs", "Amazon ECS", "AWS", "aws-ecs", AWS_COMPUTE, "processor", "Managed container orchestration (EC2 or Fargate).", "service"],
  ["aws.step-functions", "Step Functions", "AWS", "aws-step-functions", AWS_INTEGRATION, "processor", "Serverless state-machine workflow orchestration.", "state machine"],
  ["k8s.pod", "Kubernetes Pod", "Kubernetes", "k8s-pod", "#326CE5", "processor", "Smallest deployable unit: one or more co-located containers.", "pod"],
  ["k8s.deployment", "Kubernetes Deployment", "Kubernetes", "k8s-deployment", "#326CE5", "processor", "Declarative, replicated set of pods with rolling updates.", "deployment"],
  ["docker.container", "Docker Container", "Docker", "docker", "#2496ED", "processor", "A containerised process.", "container"],
  ["service.dotnet", ".NET Service", ".NET", "dotnet", "#512BD4", "processor", "Microservice built with .NET / ASP.NET Core.", "service"],
  ["service.java", "Java Service", "Java", "java", "#E76F00", "processor", "Microservice on the JVM (Spring Boot, Quarkus, ...).", "service"],
  ["service.node", "Node.js Service", "Node.js", "nodejs", "#5FA04E", "processor", "Microservice built on Node.js.", "service"],
  ["service.python", "Python Service", "Python", "python", "#3776AB", "processor", "Microservice built with Python (FastAPI, Django, ...).", "service"],
  ["service.go", "Go Service", "Go", "go", "#00ADD8", "processor", "Microservice written in Go.", "service"],
]);

const data = group("data", [
  ["postgres", "PostgreSQL", "PostgreSQL", "postgresql", "#336791", "store", "Open-source relational database.", "database"],
  ["sqlserver", "SQL Server", "Microsoft", "sqlserver", "#CC2927", "store", "Microsoft SQL Server relational database.", "database"],
  ["azure.sql", "Azure SQL Database", "Azure", "azure-sql", AZURE, "store", "Managed SQL Server engine as a service.", "database"],
  ["azure.cosmos-db", "Cosmos DB", "Azure", "azure-cosmos-db", "#2A9FD8", "store", "Globally distributed multi-model NoSQL database.", "container"],
  ["azure.blob-storage", "Blob Storage", "Azure", "azure-blob-storage", "#1FA898", "store", "Object storage for unstructured data.", "container"],
  ["azure.redis", "Azure Managed Redis", "Azure", "azure-redis", REDIS, "store", "Managed Redis for caching, sessions and pub/sub.", "cache"],
  ["mongodb", "MongoDB", "MongoDB", "mongodb", "#13AA52", "store", "Document database.", "database"],
  ["redis.cache", "Redis Cache", "Redis", "redis", REDIS, "store", "In-memory key-value cache.", "cache"],
  ["elasticsearch", "Elasticsearch", "Elastic", "elasticsearch", "#00BFB3", "store", "Distributed search and analytics engine.", "index"],
  ["aws.s3", "Amazon S3", "AWS", "aws-s3", "#7AA116", "store", "Object storage.", "bucket"],
  ["aws.dynamodb", "Amazon DynamoDB", "AWS", "aws-dynamodb", "#C925D1", "store", "Serverless key-value and document database.", "table"],
  ["snowflake", "Snowflake", "Snowflake", "snowflake", "#29B5E8", "store", "Cloud data warehouse.", "warehouse"],
  ["adobe.aem", "Adobe Experience Manager", "Adobe", "adobe", "#FA0F00", "store", "Headless CMS serving content fragments and treatments.", "content"],
  ["databricks", "Databricks", "Databricks", "databricks", "#FF3621", "store", "Lakehouse platform for data engineering and ML.", "lakehouse"],
]);

const network = group("network", [
  ["azure.api-management", "API Management", "Azure", "azure-api-management", "#7A52C7", "gateway", "API gateway with policies, auth, quotas and a developer portal.", "gateway"],
  ["azure.front-door", "Front Door", "Azure", "azure-front-door", AZURE, "gateway", "Global edge load balancer, CDN and WAF."],
  ["azure.app-gateway", "Application Gateway", "Azure", "azure-app-gateway", "#3E9B3A", "gateway", "Regional L7 load balancer with WAF."],
  ["aws.api-gateway", "Amazon API Gateway", "AWS", "aws-api-gateway", AWS_ANALYTICS_NET, "gateway", "Managed REST, HTTP and WebSocket APIs.", "API"],
  ["aws.elb", "Elastic Load Balancing", "AWS", "aws-elb", AWS_ANALYTICS_NET, "gateway", "Application / Network load balancer.", "ALB"],
  ["nginx", "NGINX", "NGINX", "nginx", "#009639", "gateway", "Reverse proxy, load balancer and ingress.", "reverse proxy"],
  ["kong", "Kong Gateway", "Kong", "kong", "#14B59A", "gateway", "API gateway with auth, rate-limiting and routing plugins.", "api gateway"],
  ["cloudflare", "Cloudflare", "Cloudflare", "cloudflare", "#F38020", "gateway", "Edge network: CDN, WAF, DNS and Workers."],
  ["load-balancer", "Load Balancer", "Generic", "generic-load-balancer", "#0EA5E9", "gateway", "Distributes traffic across instances."],
]);

const observability = group("observability", [
  ["grafana", "Grafana", "Grafana Labs", "grafana", "#F46800", "sink", "Dashboards and alerting over metrics, logs and traces.", "dashboards"],
  ["prometheus", "Prometheus", "Prometheus", "prometheus", "#E6522C", "sink", "Pull-based metrics collection and time-series database.", "metrics"],
  ["datadog", "Datadog", "Datadog", "datadog", "#632CA6", "sink", "SaaS monitoring, APM and log management.", "APM"],
  ["azure.app-insights", "Application Insights", "Azure", "azure-app-insights", "#8661C5", "sink", "APM and telemetry for apps, part of Azure Monitor.", "telemetry"],
  ["opentelemetry", "OpenTelemetry Collector", "OpenTelemetry", "opentelemetry", "#425CC7", "processor", "Vendor-neutral pipeline that receives, processes and exports telemetry.", "collector"],
  ["splunk", "Splunk", "Splunk", "splunk", "#ED0080", "sink", "Log search, SIEM and observability.", "logs"],
]);

const security = group("security", [
  ["azure.key-vault", "Key Vault", "Azure", "azure-key-vault", "#F28C00", "none", "Managed secrets, keys and certificates."],
  ["entra-id", "Microsoft Entra ID", "Microsoft", "entra-id", "#1490DF", "none", "Identity provider (formerly Azure AD): OAuth/OIDC tokens.", "identity"],
  ["vault", "HashiCorp Vault", "HashiCorp", "vault", "#EAB308", "none", "Secrets management, dynamic credentials and encryption."],
]);

const clients = group("clients", [
  ["client.user", "User", "Client", "client-user", "#0EA5E9", "source", "A person using the system.", "user"],
  ["client.browser", "Web Browser", "Client", "client-browser", "#6366F1", "source", "Web front-end / SPA running in a browser.", "web app"],
  ["client.mobile", "Mobile App", "Client", "client-mobile", "#10B981", "source", "iOS / Android application.", "mobile app"],
  ["client.partner", "Partner System", "Client", "client-partner", "#F97316", "sink", "External system or third-party API.", "external"],
  ["client.iot", "IoT Device", "Client", "client-iot", "#14B8A6", "source", "Sensor or edge device emitting telemetry.", "device"],
]);

const generic = group("generic", [
  ["generic.service", "Service", "Generic", "generic-service", "#6366F1", "processor", "A generic microservice.", "service"],
  ["generic.database", "Database", "Generic", "generic-database", "#0D9488", "store", "A generic database.", "database"],
  ["generic.queue", "Queue", "Generic", "generic-queue", "#F59E0B", "queue", "Point-to-point queue: each message goes to one consumer.", "queue"],
  ["generic.topic", "Topic", "Generic", "generic-topic", "#8B5CF6", "topic", "Pub/sub topic: every subscriber gets a copy.", "topic"],
  ["generic.scheduler", "Scheduler", "Generic", "generic-scheduler", "#64748B", "source", "Cron / timer that triggers work on a schedule.", "cron"],
  ["generic.webhook", "Webhook", "Generic", "generic-webhook", "#EC4899", "source", "Inbound HTTP callback from another system.", "webhook"],
  ["generic.email", "Email", "Generic", "generic-email", "#EF4444", "sink", "Outbound email / notification delivery.", "email"],
  ["github-actions", "GitHub Actions", "GitHub", "github-actions", "#2088FF", "source", "CI/CD workflows that build, test and deploy.", "workflow"],
]);

export const catalog: Stencil[] = [
  ...messaging,
  ...compute,
  ...data,
  ...network,
  ...observability,
  ...security,
  ...clients,
  ...generic,
];
