import { diagnostic, type ImportText } from "./graph";
import type { DiagramGroup } from "../../model/types";

// Terraform resource types → stencils (docs/research/imports.md § Mapping: Terraform). Data, with tests: a
// whitelist like Inframap's, and everything else is listed in the report with a reason, never dropped silently.

/** Component types, drawn on their stencil. */
const TYPES: Record<string, string> = {
  // AWS: messaging
  aws_sqs_queue: "aws.sqs",
  aws_sns_topic: "aws.sns",
  aws_kinesis_stream: "aws.kinesis",
  aws_msk_cluster: "aws.msk",
  aws_msk_serverless_cluster: "aws.msk",
  aws_mq_broker: "aws.mq",
  aws_cloudwatch_event_bus: "aws.eventbridge",
  // AWS: compute and entry points
  aws_lambda_function: "aws.lambda",
  aws_ecs_service: "aws.ecs",
  aws_sfn_state_machine: "aws.step-functions",
  aws_lb: "aws.elb",
  aws_alb: "aws.elb",
  aws_api_gateway_rest_api: "aws.api-gateway",
  aws_apigatewayv2_api: "aws.api-gateway",
  aws_cloudfront_distribution: "generic.cdn",
  aws_wafv2_web_acl: "generic.firewall",
  aws_scheduler_schedule: "generic.scheduler",
  // AWS: data
  aws_dynamodb_table: "aws.dynamodb",
  aws_s3_bucket: "aws.s3",
  aws_elasticache_cluster: "redis.cache",
  aws_elasticache_replication_group: "redis.cache",
  aws_elasticache_serverless_cache: "redis.cache",
  aws_redshift_cluster: "aws.redshift",
  // AWS: secrets, config, identity
  aws_secretsmanager_secret: "aws.secrets-manager",
  aws_ssm_parameter: "aws.parameter-store",
  aws_iam_role: "aws.iam-role",
  // Azure: messaging
  azurerm_servicebus_queue: "azure.service-bus.queue",
  azurerm_servicebus_topic: "azure.service-bus.topic",
  azurerm_eventhub: "azure.event-hubs",
  azurerm_eventgrid_topic: "azure.event-grid",
  azurerm_eventgrid_system_topic: "azure.event-grid",
  azurerm_eventgrid_domain: "azure.event-grid",
  azurerm_storage_queue: "azure.storage-queue",
  // Azure: compute
  azurerm_function_app: "azure.functions",
  azurerm_linux_function_app: "azure.functions",
  azurerm_windows_function_app: "azure.functions",
  azurerm_function_app_flex_consumption: "azure.functions",
  azurerm_app_service: "azure.app-service",
  azurerm_linux_web_app: "azure.app-service",
  azurerm_windows_web_app: "azure.app-service",
  azurerm_container_app: "azure.container-apps",
  azurerm_kubernetes_cluster: "azure.aks",
  azurerm_logic_app_workflow: "azure.logic-apps",
  azurerm_signalr_service: "azure.signalr",
  azurerm_static_web_app: "azure.static-web-apps",
  // Azure: data
  azurerm_mssql_database: "azure.sql",
  azurerm_postgresql_flexible_server: "postgres",
  azurerm_mysql_flexible_server: "mysql",
  azurerm_cosmosdb_account: "azure.cosmos-db",
  azurerm_redis_cache: "azure.redis",
  azurerm_managed_redis: "azure.redis",
  azurerm_storage_account: "azure.blob-storage",
  azurerm_data_factory: "azure.data-factory",
  azurerm_synapse_workspace: "azure.synapse",
  // Azure: secrets, config, identity, entry points, telemetry
  azurerm_key_vault: "azure.key-vault",
  azurerm_app_configuration: "azure.app-config",
  azurerm_user_assigned_identity: "azure.managed-identity",
  azurerm_api_management: "azure.api-management",
  azurerm_cdn_frontdoor_profile: "azure.front-door",
  azurerm_frontdoor: "azure.front-door",
  azurerm_application_gateway: "azure.app-gateway",
  azurerm_application_insights: "azure.app-insights",
  // Google Cloud
  google_pubsub_topic: "gcp.pubsub",
  google_cloud_run_service: "gcp.cloud-run",
  google_cloud_run_v2_service: "gcp.cloud-run",
  google_cloudfunctions_function: "gcp.cloud-functions",
  google_cloudfunctions2_function: "gcp.cloud-functions",
  google_container_cluster: "gcp.gke",
  google_dataflow_job: "gcp.dataflow",
  google_dataflow_flex_template_job: "gcp.dataflow",
  google_sql_database_instance: "gcp.cloud-sql",
  google_spanner_instance: "gcp.spanner",
  google_bigquery_dataset: "gcp.bigquery",
  google_storage_bucket: "gcp.cloud-storage",
  google_firestore_database: "gcp.firestore",
  google_redis_instance: "redis.cache",
  google_secret_manager_secret: "gcp.secret-manager",
  google_service_account: "gcp.service-account",
  google_cloud_scheduler_job: "generic.scheduler",
  // Kafka
  confluent_kafka_topic: "kafka.topic",
  confluent_kafka_cluster: "confluent.cloud",
  kafka_topic: "kafka.topic",
};

/** The attribute that names a resource, where it isn't `name`. */
const NAME_ATTR: Record<string, string> = {
  aws_lambda_function: "function_name",
  aws_msk_cluster: "cluster_name",
  aws_msk_serverless_cluster: "cluster_name",
  aws_mq_broker: "broker_name",
  aws_s3_bucket: "bucket",
  aws_db_instance: "identifier",
  aws_rds_cluster: "cluster_identifier",
  aws_elasticache_cluster: "cluster_id",
  aws_elasticache_replication_group: "replication_group_id",
  aws_redshift_cluster: "cluster_identifier",
  google_bigquery_dataset: "dataset_id",
  google_service_account: "account_id",
  confluent_kafka_topic: "topic_name",
};
export const nameAttr = (type: string) => (Object.hasOwn(NAME_ATTR, type) ? NAME_ATTR[type] : "name");

/** Relational databases: the engine picks the stencil. */
const ENGINE_TYPES = new Set(["aws_db_instance", "aws_rds_cluster"]);

/** The stencil of a component type, or undefined. `engine` (an RDS engine name) picks a database's stencil. */
export function stencilOf(type: string, engine?: string): string | undefined {
  if (ENGINE_TYPES.has(type)) {
    const e = (engine ?? "").toLowerCase();
    return /^aurora/.test(e)
      ? "aws.aurora"
      : /postgres/.test(e)
        ? "postgres"
        : /mysql|mariadb/.test(e)
          ? "mysql"
          : /sqlserver/.test(e)
            ? "sqlserver"
            : "generic.database";
  }
  return Object.hasOwn(TYPES, type) ? TYPES[type] : undefined;
}

/**
 * Glue: resources that are a connection in themselves (a subscription, an event-source mapping, a target). They
 * become flows between the resources they join, never nodes.
 */
export const GLUE = new Set([
  "aws_sns_topic_subscription",
  "aws_lambda_event_source_mapping",
  "aws_cloudwatch_event_rule",
  "aws_cloudwatch_event_target",
  "aws_s3_bucket_notification",
  "aws_sqs_queue_redrive_policy",
  "aws_lb_listener",
  "aws_lb_listener_rule",
  "aws_alb_listener",
  "aws_alb_listener_rule",
  "aws_lb_target_group",
  "aws_alb_target_group",
  "aws_lb_target_group_attachment",
  "aws_alb_target_group_attachment",
  "aws_api_gateway_integration",
  "aws_apigatewayv2_integration",
  "azurerm_servicebus_subscription",
  "azurerm_eventgrid_event_subscription",
  "azurerm_eventgrid_system_topic_event_subscription",
  "google_pubsub_subscription",
  // Grants that say who reads or writes what (an Azure role assignment, a Key Vault access policy, an IAM policy):
  // read for identity and secret relationships, never drawn.
  "azurerm_role_assignment",
  "azurerm_key_vault_access_policy",
  "aws_iam_role_policy",
  "aws_iam_policy",
  "aws_iam_role_policy_attachment",
  "aws_iam_policy_attachment",
]);

/** Container types whose children are drawn: they're listed, not drawn themselves. */
const CONTAINERS: Record<string, () => ImportText> = {
  azurerm_servicebus_namespace: () => diagnostic("importReason.shownThroughItsQueuesAndTopics"),
  azurerm_eventhub_namespace: () => diagnostic("importReason.shownThroughItsEventHubs"),
  azurerm_mssql_server: () => diagnostic("importReason.shownThroughItsDatabases"),
  azurerm_resource_group: () => diagnostic("importDetail.notAComponent"),
  azurerm_service_plan: () => diagnostic("importReason.hostingPlan"),
  azurerm_app_service_plan: () => diagnostic("importReason.hostingPlan"),
  aws_ecs_cluster: () => diagnostic("importReason.shownThroughItsServices"),
  aws_ecs_task_definition: () => diagnostic("importReason.partOfAnECSService"),
  aws_rds_cluster_instance: () => diagnostic("importReason.partOfTheCluster"),
  aws_secretsmanager_secret_version: () => diagnostic("importReason.aSecretsValueNeverRead"),
  azurerm_key_vault_secret: () => diagnostic("importReason.aSecretsValueNeverRead"),
  azurerm_key_vault_key: () => diagnostic("importReason.partOfKeyVault"),
  azurerm_key_vault_certificate: () => diagnostic("importReason.partOfKeyVault"),
  azurerm_eventhub_consumer_group: () => diagnostic("importReason.partOfEventHubs"),
  aws_kms_key: () => diagnostic("importReason.encryptionKey"),
  aws_kms_alias: () => diagnostic("importReason.encryptionKey"),
  google_project_service: () => diagnostic("importReason.anEnabledAPI"),
};

/** Not drawn, by kind: the reason the report gives. First match wins; the table and glue come before these. */
const SUPPORTING: [RegExp, () => ImportText][] = [
  [
    /^(?:random|null|time|tls|local|archive|external|http|cloudinit|terraform)_|^terraform_data$/,
    () => diagnostic("importReason.helperNotInfrastructure"),
  ],
  [/^aws_api_?gateway(?:v2)?_/, () => diagnostic("importReason.partOfAPIGateway")],
  [/^aws_a?lb_/, () => diagnostic("importReason.partOfALoadBalancer")],
  [
    /_iam_|^aws_iam|_policy(?:_|$)|_role_assignment|_role_definition|_access_policy|_permission|_authorization_rule|_sas$/,
    () => diagnostic("importReason.accessAndPermissions"),
  ],
  [
    /_vpc|_subnet|_security_group|_route|_nat_|_eip$|_internet_gateway|_network|_firewall_rule|_dns_|_record$|_endpoint$|_public_ip|_peering|_vpn|_zone$/,
    () => diagnostic("importReason.networking"),
  ],
  [
    /_log_group|_alarm|_metric|_diagnostic_setting|_monitor|_dashboard|_log_analytics/,
    () => diagnostic("importReason.monitoring"),
  ],
];

/** Names that sound like a component: drawn as a guess on a generic stencil, and listed with chips. */
const GUESSES: [RegExp, string][] = [
  [/_(?:database|db)$/, "generic.database"],
  [/_bucket$/, "generic.file"],
  [/_queue$/, "generic.queue"],
  [/_topic$/, "generic.topic"],
  [/_(?:function|cluster|instance|service|app)$/, "generic.service"],
];
const ALTERNATIVES = ["generic.service", "generic.database", "generic.external-api"];

/** A type that isn't in the table but sounds like a component: its stencil, as a guess with chips. */
export function guessOf(type: string): { stencil: string; alternatives: string[] } | undefined {
  const stencil = GUESSES.find(([re]) => re.test(type))?.[1];
  return stencil ? { stencil, alternatives: ALTERNATIVES.filter((a) => a !== stencil) } : undefined;
}

/**
 * Why a type isn't drawn: a container of drawn things, a part of a drawn type ("aws_s3_bucket_versioning" is part of
 * aws_s3_bucket), or its kind. Undefined: it sounds like a component (`guessOf`).
 */
export function notDrawnReason(type: string): ImportText | undefined {
  if (Object.hasOwn(CONTAINERS, type)) return CONTAINERS[type]();
  const kind = SUPPORTING.find(([re]) => re.test(type))?.[1];
  if (kind) return kind();
  // The longest drawn type this one extends: its settings, not a component of its own.
  let part = "";
  for (let i = type.lastIndexOf("_"); i > 0; i = type.lastIndexOf("_", i - 1)) {
    const base = type.slice(0, i);
    if (Object.hasOwn(TYPES, base) || ENGINE_TYPES.has(base)) {
      part = base;
      break;
    }
  }
  if (part) return diagnostic("importReason.partOf", { type: part });
  return guessOf(type) ? undefined : diagnostic("importDetail.terraformTypeNotDrawn");
}

/** Broad kinds of supporting resources, for the report's summary line. */
export const SUPPORTING_KINDS = () => SUPPORTING.map(([, reason]) => reason());

/** The provider's tone for a boundary: from the type's prefix. */
export function toneOf(type: string): DiagramGroup["tone"] {
  return type.startsWith("aws_")
    ? "aws"
    : type.startsWith("azurerm_") || type.startsWith("azapi_")
      ? "azure"
      : type.startsWith("google_")
        ? "gcp"
        : "neutral";
}
