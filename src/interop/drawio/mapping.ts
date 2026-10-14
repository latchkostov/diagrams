import type { DiagramGroup } from "../../model/types";

// Stencil <-> draw.io shape mapping. Export uses draw.io's own built-in shapes where one exists
// (Azure: the `img/lib/azure2/...` icon set; AWS: `mxgraph.aws4.resourceIcon`; Kubernetes:
// `mxgraph.kubernetes.icon2`), so the file looks native in diagrams.net. Import reads those back,
// plus the common legacy/alternate spellings people have in older files.
//
// Paths and names were checked against jgraph/drawio (src/main/webapp/img/lib/azure2/** and
// js/diagramly/sidebar/Sidebar-AWS4.js / Sidebar-Kubernetes.js), October 2026.

export interface DrawioShape {
  /** Full style string (without label / position keys). */
  style: string;
  width: number;
  height: number;
}

const AZURE_BASE =
  "image;aspect=fixed;html=1;points=[];align=center;fontSize=12;verticalLabelPosition=bottom;verticalAlign=top;";
const AWS_BASE =
  "sketch=0;outlineConnect=0;fontColor=#232F3E;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;";
const K8S_BASE =
  "aspect=fixed;sketch=0;html=1;dashed=0;whitespace=wrap;verticalLabelPosition=bottom;verticalAlign=top;fillColor=#2875E2;strokeColor=#ffffff;shape=mxgraph.kubernetes.icon2;";

/** Stencil id -> azure2 icon path (relative to img/lib/azure2/). */
export const AZURE_ICONS: Record<string, string> = {
  "azure.service-bus.queue": "integration/Service_Bus.svg",
  "azure.service-bus.topic": "integration/Service_Bus.svg",
  "azure.event-hubs": "analytics/Event_Hubs.svg",
  "azure.event-grid": "integration/Event_Grid_Topics.svg",
  "azure.storage-queue": "general/Storage_Queue.svg",
  "azure.functions": "compute/Function_Apps.svg",
  "azure.app-service": "app_services/App_Services.svg",
  "azure.container-apps": "other/Worker_Container_App.svg",
  "azure.aks": "compute/Kubernetes_Services.svg",
  "azure.logic-apps": "integration/Logic_Apps.svg",
  "azure.signalr": "web/SignalR.svg",
  "azure.sql": "databases/SQL_Database.svg",
  "azure.cosmos-db": "databases/Azure_Cosmos_DB.svg",
  "azure.blob-storage": "storage/Storage_Accounts.svg",
  "azure.redis": "databases/Cache_Redis.svg",
  sqlserver: "databases/SQL_Server.svg",
  "azure.api-management": "integration/API_Management_Services.svg",
  "azure.front-door": "networking/Front_Doors.svg",
  "azure.app-gateway": "networking/Application_Gateways.svg",
  "azure.app-insights": "devops/Application_Insights.svg",
  "azure.key-vault": "security/Key_Vaults.svg",
  "entra-id": "identity/Azure_Active_Directory.svg",
  "azure.app-config": "integration/App_Configuration.svg",
  "azure.managed-identity": "identity/Managed_Identities.svg",
};

/** Stencil id -> [aws4 resIcon name, category fill colour]. */
export const AWS_ICONS: Record<string, [string, string]> = {
  "aws.sqs": ["sqs", "#E7157B"],
  "aws.sns": ["sns", "#E7157B"],
  "aws.eventbridge": ["eventbridge", "#E7157B"],
  "aws.step-functions": ["step_functions", "#E7157B"],
  "aws.kinesis": ["kinesis_data_streams", "#8C4FFF"],
  "aws.api-gateway": ["api_gateway", "#8C4FFF"],
  "aws.elb": ["elastic_load_balancing", "#8C4FFF"],
  "aws.lambda": ["lambda", "#ED7100"],
  "aws.ecs": ["ecs", "#ED7100"],
  "aws.s3": ["s3", "#7AA116"],
  "aws.dynamodb": ["dynamodb", "#C925D1"],
  "aws.secrets-manager": ["secrets_manager", "#DD344C"],
  "aws.cloudwatch": ["cloudwatch_2", "#E7157B"],
};

export const K8S_ICONS: Record<string, string> = {
  "k8s.pod": "pod",
  "k8s.deployment": "deploy",
  "k8s.configmap": "cm",
  "k8s.secret": "secret",
};

/** draw.io's built-in shape for a stencil, if there is one. */
export function nativeShape(stencilId: string): DrawioShape | undefined {
  const az = AZURE_ICONS[stencilId];
  if (az) return { style: `${AZURE_BASE}image=img/lib/azure2/${az};`, width: 56, height: 56 };
  const aws = AWS_ICONS[stencilId];
  if (aws) return { style: `${AWS_BASE}fillColor=${aws[1]};resIcon=mxgraph.aws4.${aws[0]};`, width: 56, height: 56 };
  const k8s = K8S_ICONS[stencilId];
  if (k8s) return { style: `${K8S_BASE}prIcon=${k8s};`, width: 50, height: 48 };
  return undefined;
}

/** An image shape for stencils draw.io has no shape for: our own icon, inlined as a data URI. */
export function imageShape(svgBase64: string): DrawioShape {
  // draw.io's convention: "data:image/svg+xml,<base64>" (no ";base64", since ';' separates style keys).
  return { style: `${AZURE_BASE}image=data:image/svg+xml,${svgBase64};`, width: 56, height: 56 };
}

/** Last resort when no icon is available: a tinted rounded box with the label inside. */
export function boxShape(accent: string): DrawioShape {
  return {
    style: `rounded=1;whiteSpace=wrap;html=1;arcSize=18;fillColor=${accent}1A;strokeColor=${accent};fontSize=12;`,
    width: 180,
    height: 60,
  };
}

// ---------------------------------------------------------------- groups

export const TONE_COLORS: Record<NonNullable<DiagramGroup["tone"]>, string> = {
  azure: "#0078D4",
  aws: "#232F3E",
  gcp: "#4285F4",
  k8s: "#326CE5",
  onprem: "#64748B",
  neutral: "#94A3B8",
};

export function groupStyle(tone: NonNullable<DiagramGroup["tone"]>): string {
  const c = TONE_COLORS[tone];
  const base = `container=1;collapsible=0;recursiveResize=0;html=1;whiteSpace=wrap;fillColor=none;verticalAlign=top;align=left;fontStyle=1;fontSize=12;fontColor=${c};strokeColor=${c};`;
  if (tone === "aws")
    return `points=[];outlineConnect=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;spacingLeft=30;dashed=0;${base}`;
  return `rounded=1;arcSize=3;absoluteArcSize=1;dashed=1;spacingLeft=12;spacingTop=4;${base}`;
}

// ---------------------------------------------------------------- import

/** Basename (lower case, no extension) of azure2 / mscae / legacy icon files -> stencil id. */
const IMAGE_NAMES: Record<string, string> = {
  service_bus: "azure.service-bus.queue",
  azure_service_bus: "azure.service-bus.queue",
  service_bus_queues: "azure.service-bus.queue",
  service_bus_topics: "azure.service-bus.topic",
  event_hubs: "azure.event-hubs",
  event_hub_clusters: "azure.event-hubs",
  event_grid_topics: "azure.event-grid",
  event_grid_domains: "azure.event-grid",
  event_grid_subscriptions: "azure.event-grid",
  system_topic: "azure.event-grid",
  storage_queue: "azure.storage-queue",
  function_apps: "azure.functions",
  functions: "azure.functions",
  app_services: "azure.app-service",
  app_service: "azure.app-service",
  worker_container_app: "azure.container-apps",
  container_app_environments: "azure.container-apps",
  kubernetes_services: "azure.aks",
  logic_apps: "azure.logic-apps",
  signalr: "azure.signalr",
  sql_database: "azure.sql",
  azure_sql: "azure.sql",
  sql_server: "sqlserver",
  azure_cosmos_db: "azure.cosmos-db",
  cosmos_db: "azure.cosmos-db",
  azure_documentdb: "azure.cosmos-db",
  storage_accounts: "azure.blob-storage",
  blob_block: "azure.blob-storage",
  blob_page: "azure.blob-storage",
  storage_container: "azure.blob-storage",
  data_lake_storage_gen1: "azure.blob-storage",
  cache_redis: "azure.redis",
  azure_managed_redis: "azure.redis",
  azure_database_postgresql_server: "postgres",
  api_management_services: "azure.api-management",
  front_doors: "azure.front-door",
  application_gateways: "azure.app-gateway",
  load_balancers: "load-balancer",
  application_insights: "azure.app-insights",
  monitor: "azure.app-insights",
  log_analytics_workspaces: "azure.app-insights",
  key_vaults: "azure.key-vault",
  app_configuration: "azure.app-config",
  managed_identities: "azure.managed-identity",
  managed_identity: "azure.managed-identity",
  azure_active_directory: "entra-id",
  entra_identity: "entra-id",
  azure_databricks: "databricks",
  grafana: "grafana",
  prometheus: "prometheus",
  iot_hub: "client.iot",
  mobile: "client.mobile",
  browser: "client.browser",
  scheduler: "generic.scheduler",
};

/** aws4 resIcon / shape names (and aws3 shape names) -> stencil id. */
const AWS_NAMES: Record<string, string> = {
  sqs: "aws.sqs",
  queue: "aws.sqs",
  simple_queue_service: "aws.sqs",
  sns: "aws.sns",
  topic: "aws.sns",
  simple_notification_service: "aws.sns",
  eventbridge: "aws.eventbridge",
  eventbridge_event_bus: "aws.eventbridge",
  event_bus: "aws.eventbridge",
  step_functions: "aws.step-functions",
  kinesis: "aws.kinesis",
  kinesis_data_streams: "aws.kinesis",
  kinesis_streams: "aws.kinesis",
  api_gateway: "aws.api-gateway",
  elastic_load_balancing: "aws.elb",
  application_load_balancer: "aws.elb",
  network_load_balancer: "aws.elb",
  classic_load_balancer: "aws.elb",
  lambda: "aws.lambda",
  lambda_function: "aws.lambda",
  ecs: "aws.ecs",
  elastic_container_service: "aws.ecs",
  fargate: "aws.ecs",
  s3: "aws.s3",
  simple_storage_service: "aws.s3",
  bucket: "aws.s3",
  dynamodb: "aws.dynamodb",
  dynamodb_table: "aws.dynamodb",
  rds: "postgres",
  aurora: "postgres",
  elasticache: "redis.cache",
  msk: "kafka.cluster",
  managed_streaming_for_kafka: "kafka.cluster",
  mq: "rabbitmq.queue",
  cloudfront: "cloudflare",
  user: "client.user",
  users: "client.user",
  client: "client.browser",
  mobile_client: "client.mobile",
  secrets_manager: "aws.secrets-manager",
  parameter_store: "aws.parameter-store",
  systems_manager_parameter_store: "aws.parameter-store",
  role: "aws.iam-role",
  iam_role: "aws.iam-role",
  cloudwatch: "aws.cloudwatch",
  cloudwatch_2: "aws.cloudwatch",
};

const K8S_NAMES: Record<string, string> = {
  pod: "k8s.pod",
  deploy: "k8s.deployment",
  deployment: "k8s.deployment",
  ing: "nginx",
  cm: "k8s.configmap",
  configmap: "k8s.configmap",
  secret: "k8s.secret",
};

/** Shapes that say what a box is, but not which product: label keywords take precedence over these. */
const GENERIC_SHAPES: [RegExp, string][] = [
  [
    /^(cylinder\d?|datastore|mxgraph\.flowchart\.database|mxgraph\.flowchart\.stored_data|mxgraph\.basic\.cylinder.*)$/,
    "generic.database",
  ],
  [/^(actor|umlactor|mxgraph\.basic\.person)$/, "client.user"],
  [/^(mxgraph\.flowchart\.direct_data|mxgraph\.lean_mapping\.fifo_sequence_flow|queue)$/, "generic.queue"],
  [/^(mxgraph\.flowchart\.delay|mxgraph\.ios7\.icons\.clock)$/, "generic.scheduler"],
  [
    /^(mxgraph\.mockup\.containers\.browserwindow|mxgraph\.cisco\.computers_and_peripherals\.web_browser)$/,
    "client.browser",
  ],
  [/^(mxgraph\.mockup\.containers\.smartphone|mxgraph\.android\.phone2)$/, "client.mobile"],
];

/** Parses a draw.io style string ("a=1;b;c=2") into a map. Bare words map to "" and become `_shape` if first. */
export function parseStyle(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  style.split(";").forEach((part, i) => {
    if (!part) return;
    const eq = part.indexOf("=");
    if (eq === -1) {
      out[part] = "";
      if (i === 0) out._base = part;
    } else {
      out[part.slice(0, eq)] = part.slice(eq + 1);
    }
  });
  return out;
}

export interface StyleMatch {
  stencil: string;
  /** True when the style names a product; false for generic shapes (cylinder, actor...). */
  specific: boolean;
}

const basename = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(svg|png|jpe?g)$/i, "")
    .replace(/^\d+-icon-service-/i, "")
    .toLowerCase()
    .replace(/[-\s]+/g, "_");

/** Which stencil a draw.io style describes, if any. */
export function stencilFromStyle(style: Record<string, string>): StyleMatch | undefined {
  const image = style.image;
  if (image && !image.startsWith("data:")) {
    const hit = IMAGE_NAMES[basename(image)];
    if (hit) return { stencil: hit, specific: true };
  }
  const shape = (style.shape ?? style._base ?? "").toLowerCase();
  const resIcon = (style.resIcon ?? "").toLowerCase();
  const prIcon = (style.prIcon ?? "").toLowerCase();

  if (resIcon.startsWith("mxgraph.aws4.")) {
    const hit = AWS_NAMES[resIcon.slice("mxgraph.aws4.".length)];
    if (hit) return { stencil: hit, specific: true };
  }
  for (const prefix of ["mxgraph.aws4.", "mxgraph.aws3.", "mxgraph.aws2."]) {
    if (shape.startsWith(prefix)) {
      const name = shape.slice(prefix.length);
      const hit = AWS_NAMES[name] ?? AWS_NAMES[name.replace(/_(2|alt|instance)$/, "")];
      if (hit) return { stencil: hit, specific: true };
    }
  }
  if (shape.startsWith("mxgraph.kubernetes.")) {
    const hit = K8S_NAMES[prIcon] ?? (shape.endsWith(".pod") ? "k8s.pod" : undefined);
    if (hit) return { stencil: hit, specific: true };
  }
  if (shape.startsWith("mxgraph.azure.") || shape.startsWith("mxgraph.mscae.")) {
    const name = shape.split(".").pop()!;
    const hit = IMAGE_NAMES[name] ?? IMAGE_NAMES[name.replace(/^azure_/, "")];
    if (hit) return { stencil: hit, specific: true };
    if (/database|sql/.test(name)) return { stencil: "azure.sql", specific: true };
  }
  // draw.io's Cisco libraries (mxgraph.cisco.*, and cisco19's prIcon): network devices, as the generic kind. The
  // label may still name a vendor (inferStencil), so these aren't specific.
  if (shape.startsWith("mxgraph.cisco")) {
    const name = `${shape} ${prIcon}`;
    const hit = /firewall|[._]asa|pix/.test(name)
      ? "generic.ngfw"
      : /load_balancer|content_switch|\bace\b|\bcss\b/.test(name)
        ? "generic.adc"
        : /router/.test(name)
          ? "generic.router"
          : /switch/.test(name)
            ? "generic.switch"
            : undefined;
    if (hit) return { stencil: hit, specific: false };
  }
  for (const [re, id] of GENERIC_SHAPES) if (re.test(shape)) return { stencil: id, specific: false };
  return undefined;
}

/** Tone for a container from its style and label. */
export function toneFromStyle(style: Record<string, string>, label: string): NonNullable<DiagramGroup["tone"]> {
  const hay = `${style.shape ?? ""} ${style.grIcon ?? ""} ${label}`.toLowerCase();
  if (/aws|amazon/.test(hay)) return "aws";
  if (/azure|microsoft/.test(hay)) return "azure";
  if (/gcp|google/.test(hay)) return "gcp";
  if (/k8s|kubernetes|\baks\b|\beks\b|\bgke\b|cluster|namespace/.test(hay)) return "k8s";
  if (/on.?prem|data ?cent(er|re)|corporate|datacenter/.test(hay)) return "onprem";
  const stroke = (style.strokeColor ?? "").toUpperCase();
  for (const [tone, c] of Object.entries(TONE_COLORS))
    if (stroke === c) return tone as NonNullable<DiagramGroup["tone"]>;
  return "neutral";
}
