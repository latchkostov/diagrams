// Guess a stencil from free text (a label, a draw.io style, a Mermaid shape). Used by the draw.io and
// Mermaid importers when a file doesn't say which stencil a box is. Order matters: the first rule
// that matches wins, so specific products come before generic words.

export const FALLBACK_STENCIL_ID = "generic.service";

/** [pattern, stencil id]. Patterns run against lower-cased text with punctuation folded to spaces. */
const RULES: [RegExp, string][] = [
  // Config, secrets and identity first: "Kubernetes ConfigMap" isn't a pod, "secrets manager" isn't Vault.
  [/\bapp ?config(uration)?\b|\bappcs\b/, "azure.app-config"],
  [/\bmanaged identit(y|ies)\b|\bworkload identity\b|\bmsi\b/, "azure.managed-identity"],
  [/\bsecrets manager\b/, "aws.secrets-manager"],
  [/\bsecret manager\b/, "gcp.secret-manager"],
  [/\bparameter store\b|\bssm\b/, "aws.parameter-store"],
  [/\biam roles?\b|\birsa\b|\bexecution role\b|\btask role\b/, "aws.iam-role"],
  [/\bconfig ?maps?\b/, "k8s.configmap"],
  [/\b(kubernetes|k8s) secrets?\b/, "k8s.secret"],
  [/\bcloud ?watch\b/, "aws.cloudwatch"],
  [/\bconfig(uration)? (store|service|server)\b/, "generic.config-store"],
  [/\bsecrets? stores?\b/, "generic.secret-store"],
  [/\bidentity provider\b|\bidp\b/, "generic.identity-provider"],
  // Messaging
  [/\bschema registry\b/, "kafka.schema-registry"],
  [/\bkafka connect\b|\bdebezium\b/, "kafka.connect"],
  [/\bksql(db)?\b/, "kafka.ksqldb"],
  [/\b(kafka|msk|confluent) (cluster|broker)s?\b|\bbrokers?\b/, "kafka.cluster"],
  [/\bkafka\b|\bconfluent\b|\bmsk\b/, "kafka.topic"],
  [/\bservice ?bus\b.*\btopic\b|\bsb topic\b/, "azure.service-bus.topic"],
  [/\bservice ?bus\b/, "azure.service-bus.queue"],
  [/\bevent ?hubs?\b/, "azure.event-hubs"],
  [/\bevent ?grid\b/, "azure.event-grid"],
  [/\bstorage queues?\b|\bazure queues?\b/, "azure.storage-queue"],
  [/\brabbit ?mq\b.*\bexchange\b|\bexchange\b/, "rabbitmq.exchange"],
  [/\brabbit ?mq\b|\bamqp\b/, "rabbitmq.queue"],
  [/\bsqs\b/, "aws.sqs"],
  [/\bsns\b/, "aws.sns"],
  [/\bevent ?bridge\b/, "aws.eventbridge"],
  [/\bkinesis\b/, "aws.kinesis"],
  [/\bpub ?sub\b/, "gcp.pubsub"],
  [/\bnats\b|\bjetstream\b/, "nats.subject"],
  [/\bredis streams?\b/, "redis.stream"],
  // Compute
  [/\bfunction apps?\b|\bazure functions?\b/, "azure.functions"],
  [/\bapp services?\b|\bweb apps?\b/, "azure.app-service"],
  [/\bcontainer apps?\b/, "azure.container-apps"],
  [/\baks\b|\bazure kubernetes\b/, "azure.aks"],
  [/\blogic apps?\b/, "azure.logic-apps"],
  [/\bsignal ?r\b/, "azure.signalr"],
  [/\blambda\b/, "aws.lambda"],
  [/\bstep functions?\b/, "aws.step-functions"],
  [/\becs\b|\bfargate\b/, "aws.ecs"],
  [/\bdeployment\b/, "k8s.deployment"],
  [/\bpods?\b|\bkubernetes\b|\bk8s\b/, "k8s.pod"],
  [/\bdocker\b|\bcontainer\b/, "docker.container"],
  [/\b(dotnet|net core|asp ?net|c#|csharp)\b|\.net\b/, "service.dotnet"],
  [/\bjava\b|\bspring\b|\bkotlin\b/, "service.java"],
  [/\bnode ?js\b|\bnode\b|\bexpress\b|\bnest ?js\b/, "service.node"],
  [/\bpython\b|\bdjango\b|\bfast ?api\b|\bflask\b/, "service.python"],
  [/\bgolang\b|\bgo service\b/, "service.go"],
  // Data
  [/\bpostgres(ql)?\b|\bpg\b|\baurora\b|\brds\b/, "postgres"],
  [/\bazure sql\b|\bsql database\b/, "azure.sql"],
  [/\bsql server\b|\bmssql\b/, "sqlserver"],
  [/\bcosmos ?(db)?\b/, "azure.cosmos-db"],
  [/\bblob\b|\bstorage account\b|\badls\b|\bdata lake\b/, "azure.blob-storage"],
  [/\bazure (managed )?redis\b|\bazure cache\b/, "azure.redis"],
  [/\bmongo ?(db)?\b/, "mongodb"],
  [/\bredis\b|\belasticache\b/, "redis.cache"],
  [/\belastic ?search\b|\bopen ?search\b/, "elasticsearch"],
  [/\bs3\b|\bbucket\b/, "aws.s3"],
  [/\bdynamo ?(db)?\b/, "aws.dynamodb"],
  [/\bsnowpipe\b/, "snowflake.snowpipe"],
  [/\bsnowflake\b/, "snowflake"],
  [/\bdatabricks\b|\bspark\b/, "databricks"],
  // Data tools that move or show data rather than store it: processors and sinks, never cylinders.
  [/\bdata factory\b/, "azure.data-factory"],
  [/\bdbt\b/, "dbt"],
  [/\bairbyte\b/, "airbyte"],
  [/\breverse etl\b|\bhightouch\b/, "generic.reverse-etl"],
  [/\blooker\b/, "looker"],
  [/\btableau\b/, "tableau"],
  [/\baem\b|\badobe\b/, "adobe.aem"],
  // Network
  [/\bapi management\b|\bapim\b/, "azure.api-management"],
  [/\bfront ?door\b/, "azure.front-door"],
  [/\bapp(lication)? gateway\b/, "azure.app-gateway"],
  [/\bapi gateway\b/, "aws.api-gateway"],
  [/\belb\b|\balb\b|\bnlb\b|\belastic load\b/, "aws.elb"],
  [/\bnginx\b|\bingress\b/, "nginx"],
  [/\bkong\b/, "kong"],
  [/\bcloudflare\b|\bcdn\b/, "cloudflare"],
  [/\broute ?53\b/, "aws.route53"],
  [/\btraffic manager\b/, "azure.traffic-manager"],
  [/\bcloud load balancing\b/, "gcp.cloud-load-balancing"],
  [/\bload ?balancer\b/, "load-balancer"],
  // Observability
  [/\bgrafana\b/, "grafana"],
  [/\bprometheus\b/, "prometheus"],
  [/\bdatadog\b/, "datadog"],
  [/\bapp(lication)? insights\b|\bazure monitor\b|\blog analytics\b/, "azure.app-insights"],
  [/\bopen ?telemetry\b|\botel\b/, "opentelemetry"],
  [/\bsplunk\b/, "splunk"],
  // Security
  [/\bkey ?vault\b/, "azure.key-vault"],
  [/\bentra\b|\bazure ad\b|\baad\b|\bactive directory\b/, "entra-id"],
  [/\bvault\b|\bsecrets?\b/, "vault"],
  // Patterns, before clients and generic words: an "event store" is a log, not a database, and
  // "Customer.io" isn't a user.
  [/\bevent store\b/, "generic.event-store"],
  [/\bprojections?\b/, "generic.projection"],
  [/\bsaga( orchestrator)?\b/, "generic.saga"],
  [/\brate limit(er|ing)?\b/, "generic.rate-limiter"],
  [/\bmarketing automation\b|\bbraze\b|\bcustomer io\b|\biterable\b/, "generic.marketing"],
  // Clients
  [/\bbrowser\b|\bweb ?(client|ui|frontend|front end|site|spa)\b|\bfrontend\b/, "client.browser"],
  [/\bmobile\b|\bios\b|\bandroid\b/, "client.mobile"],
  [/\biot\b|\bdevices?\b|\bsensors?\b/, "client.iot"],
  [/\bpartner\b|\bthird party\b|\bexternal\b|\b3rd party\b/, "client.partner"],
  [/\busers?\b|\bcustomers?\b|\bactor\b|\bperson\b/, "client.user"],
  [/\bgithub actions?\b|\bci ?cd\b/, "github-actions"],
  // Generic
  [/\bdatabase\b|\bdb\b|\bsql\b|\bstore\b|\bwarehouse\b/, "generic.database"],
  [/\bqueue\b/, "generic.queue"],
  [/\btopic\b|\bevent bus\b|\bbroker\b|\bevents\b/, "generic.topic"],
  [/\bcron\b|\bscheduler\b|\btimer\b|\bjob\b/, "generic.scheduler"],
  [/\bwebhooks?\b|\bcallback\b/, "generic.webhook"],
  [/\be ?mail\b|\bsmtp\b|\bsendgrid\b|\bnotifications?\b/, "generic.email"],
];

export const normalizeText = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[_/\\|()[\]{}<>"'`:;,=+*!?~^%$@]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

/** Best stencil for some text, or undefined when nothing matches. */
export function inferStencil(...texts: (string | undefined)[]): string | undefined {
  const hay = normalizeText(texts.filter(Boolean).join(" "));
  if (!hay.trim()) return undefined;
  for (const [re, id] of RULES) if (re.test(hay)) return id;
  return undefined;
}
