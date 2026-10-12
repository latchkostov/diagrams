# Icon sources & licensing

All stencil icons live in `src/stencils/icons/<name>.svg`. Each file was normalised: metadata,
comments, titles and fixed `width`/`height` stripped (only `viewBox` + `xmlns` kept on the root),
unreferenced ids removed, and referenced gradient/mask/filter ids prefixed with the file name so
icons never clash when inlined.

## Sources

| Source                                                                                                                             | Version    | License / terms                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Microsoft Azure Architecture Icons](https://learn.microsoft.com/azure/architecture/icons/) (`Azure_Public_Service_Icons_V24.zip`) | V24        | Microsoft permits use of these icons in architecture diagrams, training materials and documentation; don't crop, flip, rotate or distort them, and don't use them to imply endorsement. See the Azure Icons FAQ / Microsoft Terms of Use shipped in the zip. |
| [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) (`Icon-package_07312026.zip`, 48px Arch icons)                | 2026-07-31 | AWS permits customers and partners to use these icons in architecture diagrams. Don't modify, crop or recolor them.                                                                                                                                          |
| [Google Cloud icons](https://cloud.google.com/icons) via Iconify set `gcp`                                                         | —          | Apache-2.0 (as published in the Iconify `gcp` set).                                                                                                                                                                                                          |
| [gilbarbara/logos](https://github.com/gilbarbara/logos) via `@iconify-json/logos`                                                  | 1.2.15     | CC0-1.0 (artwork); the brands are trademarks of their owners.                                                                                                                                                                                                |
| [Lucide](https://lucide.dev) via `lucide-static`                                                                                   | 1.55.0     | ISC. Stroke set to `#475569`, stroke-width 1.75.                                                                                                                                                                                                             |
| [Kubernetes community icons](https://github.com/kubernetes/community/tree/master/icons) (unlabeled resources)                      | master     | Apache-2.0 or CC-BY-4.0 (your choice). The Kubernetes logo is a trademark of The Linux Foundation.                                                                                                                                                           |
| [selfh.st/icons](https://github.com/selfhst/icons) via Iconify set `selfhst`                                                       | —          | CC-BY-4.0, **attribution required**: "Icon by selfh.st (https://selfh.st/icons), CC BY 4.0".                                                                                                                                                                 |
| [theSVG](https://github.com/glincker/thesvg) via Iconify set `thesvg-color`                                                        | —          | MIT.                                                                                                                                                                                                                                                         |
| [Simple Icons](https://simpleicons.org) via Iconify set `simple-icons`                                                             | 16.34.0    | CC0-1.0. Monochrome paths, filled with the brand hex published in Simple Icons data.                                                                                                                                                                         |
| [Devicon](https://devicon.dev) via Iconify set `devicon`                                                                           | —          | MIT.                                                                                                                                                                                                                                                         |

## Files

| Icon file                   | Source                                  | Original asset                                                                                         |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `azure-service-bus.svg`     | Azure V24                               | `integration/10836-icon-service-Azure-Service-Bus.svg`                                                 |
| `azure-event-hubs.svg`      | Azure V24                               | `analytics/00039-icon-service-Event-Hubs.svg`                                                          |
| `azure-event-grid.svg`      | Azure V24                               | `integration/10206-icon-service-Event-Grid-Topics.svg`                                                 |
| `azure-storage-queue.svg`   | Azure V24                               | `general/10840-icon-service-Storage-Queue.svg`                                                         |
| `azure-functions.svg`       | Azure V24                               | `compute/10029-icon-service-Function-Apps.svg`                                                         |
| `azure-app-service.svg`     | Azure V24                               | `app services/10035-icon-service-App-Services.svg`                                                     |
| `azure-container-apps.svg`  | Azure V24                               | `other/02989-icon-service-Container-Apps-Environments.svg`                                             |
| `azure-aks.svg`             | Azure V24                               | `compute/10023-icon-service-Kubernetes-Services.svg`                                                   |
| `azure-logic-apps.svg`      | Azure V24                               | `integration/02631-icon-service-Logic-Apps.svg`                                                        |
| `azure-sql.svg`             | Azure V24                               | `databases/02390-icon-service-Azure-SQL.svg`                                                           |
| `azure-cosmos-db.svg`       | Azure V24                               | `databases/10121-icon-service-Azure-Cosmos-DB.svg`                                                     |
| `azure-blob-storage.svg`    | Azure V24                               | `storage/10086-icon-service-Storage-Accounts.svg`                                                      |
| `azure-redis.svg`           | Azure V24                               | `databases/03675-icon-service-Azure-Managed-Redis.svg`                                                 |
| `azure-api-management.svg`  | Azure V24                               | `devops/10042-icon-service-API-Management-Services.svg`                                                |
| `azure-front-door.svg`      | Azure V24                               | `networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg`                                        |
| `azure-app-gateway.svg`     | Azure V24                               | `networking/10076-icon-service-Application-Gateways.svg`                                               |
| `azure-app-insights.svg`    | Azure V24                               | `devops/00012-icon-service-Application-Insights.svg`                                                   |
| `azure-key-vault.svg`       | Azure V24                               | `security/10245-icon-service-Key-Vaults.svg`                                                           |
| `azure-signalr.svg`         | Azure V24                               | `web/10052-icon-service-SignalR.svg`                                                                   |
| `aws-sqs.svg`               | AWS 2026-07                             | `Arch_Application-Integration/48/Arch_Amazon-Simple-Queue-Service_48.svg`                              |
| `aws-sns.svg`               | AWS 2026-07                             | `Arch_Application-Integration/48/Arch_Amazon-Simple-Notification-Service_48.svg`                       |
| `aws-eventbridge.svg`       | AWS 2026-07                             | `Arch_Application-Integration/48/Arch_Amazon-EventBridge_48.svg`                                       |
| `aws-step-functions.svg`    | AWS 2026-07                             | `Arch_Application-Integration/48/Arch_AWS-Step-Functions_48.svg`                                       |
| `aws-kinesis.svg`           | AWS 2026-07                             | `Arch_Analytics/48/Arch_Amazon-Kinesis-Data-Streams_48.svg`                                            |
| `aws-lambda.svg`            | AWS 2026-07                             | `Arch_Compute/48/Arch_AWS-Lambda_48.svg`                                                               |
| `aws-ecs.svg`               | AWS 2026-07                             | `Arch_Containers/48/Arch_Amazon-Elastic-Container-Service_48.svg`                                      |
| `aws-s3.svg`                | AWS 2026-07                             | `Arch_Storage/48/Arch_Amazon-Simple-Storage-Service_48.svg`                                            |
| `aws-dynamodb.svg`          | AWS 2026-07                             | `Arch_Databases/48/Arch_Amazon-DynamoDB_48.svg`                                                        |
| `aws-api-gateway.svg`       | AWS 2026-07                             | `Arch_Networking-Content-Delivery/48/Arch_Amazon-API-Gateway_48.svg`                                   |
| `aws-elb.svg`               | AWS 2026-07                             | `Arch_Networking-Content-Delivery/48/Arch_Elastic-Load-Balancing_48.svg`                               |
| `gcp-pubsub.svg`            | Google Cloud (Iconify `gcp`)            | https://api.iconify.design/gcp/pubsub.svg                                                              |
| `entra-id.svg`              | selfh.st (Iconify `selfhst`), CC-BY-4.0 | https://api.iconify.design/selfhst/microsoft-entra-id.svg                                              |
| `sqlserver.svg`             | theSVG (Iconify `thesvg-color`), MIT    | https://api.iconify.design/thesvg-color/microsoft-sql-server.svg                                       |
| `k8s-pod.svg`               | Kubernetes community                    | https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/pod.svg    |
| `k8s-deployment.svg`        | Kubernetes community                    | https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/deploy.svg |
| `kafka.svg`                 | gilbarbara/logos                        | `logos:kafka-icon`                                                                                     |
| `rabbitmq.svg`              | gilbarbara/logos                        | `logos:rabbitmq-icon`                                                                                  |
| `redis.svg`                 | gilbarbara/logos                        | `logos:redis`                                                                                          |
| `postgresql.svg`            | gilbarbara/logos                        | `logos:postgresql`                                                                                     |
| `mongodb.svg`               | gilbarbara/logos                        | `logos:mongodb-icon`                                                                                   |
| `elasticsearch.svg`         | gilbarbara/logos                        | `logos:elasticsearch`                                                                                  |
| `grafana.svg`               | gilbarbara/logos                        | `logos:grafana`                                                                                        |
| `prometheus.svg`            | gilbarbara/logos                        | `logos:prometheus`                                                                                     |
| `datadog.svg`               | gilbarbara/logos                        | `logos:datadog-icon`                                                                                   |
| `snowflake.svg`             | gilbarbara/logos                        | `logos:snowflake-icon`                                                                                 |
| `databricks.svg`            | gilbarbara/logos                        | `logos:databricks-icon`                                                                                |
| `nginx.svg`                 | gilbarbara/logos                        | `logos:nginx`                                                                                          |
| `cloudflare.svg`            | gilbarbara/logos                        | `logos:cloudflare-icon`                                                                                |
| `docker.svg`                | gilbarbara/logos                        | `logos:docker-icon`                                                                                    |
| `opentelemetry.svg`         | gilbarbara/logos                        | `logos:opentelemetry-icon`                                                                             |
| `splunk.svg`                | gilbarbara/logos                        | `logos:splunk` (wordmark — Splunk has no standalone symbol)                                            |
| `dotnet.svg`                | gilbarbara/logos                        | `logos:dotnet`                                                                                         |
| `java.svg`                  | gilbarbara/logos                        | `logos:java`                                                                                           |
| `nodejs.svg`                | gilbarbara/logos                        | `logos:nodejs-icon`                                                                                    |
| `python.svg`                | gilbarbara/logos                        | `logos:python`                                                                                         |
| `go.svg`                    | gilbarbara/logos                        | `logos:go`                                                                                             |
| `vault.svg`                 | gilbarbara/logos                        | `logos:vault-icon`                                                                                     |
| `nats.svg`                  | gilbarbara/logos                        | `logos:nats-icon`                                                                                      |
| `github-actions.svg`        | gilbarbara/logos                        | `logos:github-actions`                                                                                 |
| `client-user.svg`           | Lucide                                  | `user`                                                                                                 |
| `client-browser.svg`        | Lucide                                  | `app-window`                                                                                           |
| `client-mobile.svg`         | Lucide                                  | `smartphone`                                                                                           |
| `client-partner.svg`        | Lucide                                  | `building-2`                                                                                           |
| `client-iot.svg`            | Lucide                                  | `cpu`                                                                                                  |
| `generic-service.svg`       | Lucide                                  | `box`                                                                                                  |
| `generic-database.svg`      | Lucide                                  | `database`                                                                                             |
| `generic-queue.svg`         | Lucide                                  | `inbox`                                                                                                |
| `generic-topic.svg`         | Lucide                                  | `radio-tower`                                                                                          |
| `generic-scheduler.svg`     | Lucide                                  | `clock`                                                                                                |
| `generic-webhook.svg`       | Lucide                                  | `webhook`                                                                                              |
| `generic-email.svg`         | Lucide                                  | `mail`                                                                                                 |
| `generic-load-balancer.svg` | Lucide                                  | `network`                                                                                              |
| `generic-box.svg`           | Lucide-style (pre-existing)             | Fallback icon for unknown stencils                                                                     |

## Trademarks

Product names, logos and icons are trademarks of their respective owners (Microsoft, Amazon,
Google, The Apache Software Foundation, Broadcom/VMware (RabbitMQ), Redis Ltd., The Linux
Foundation, HashiCorp, Splunk/Cisco, Confluent, Okta, Stripe, Twilio, Salesforce, HubSpot, Slack,
GitHub, OpenAI, Anthropic, etc.). They're used **nominatively**, only to show those
products in architecture diagrams. This doesn't imply any affiliation with or endorsement by
the trademark owners. Don't alter the logos beyond scaling, and don't use them as the app's own branding.

The CC-BY-4.0 `entra-id.svg` (selfh.st) needs attribution. Keep this file, or add a credits
line in the app, when distributing.

### Added later

| Icon file   | Source                 | Original asset                                         |
| ----------- | ---------------------- | ------------------------------------------------------ |
| `kong.svg`  | gilbarbara/logos (CC0) | `logos:kong-icon`                                      |
| `adobe.svg` | gilbarbara/logos (CC0) | `logos:adobe-icon` (used for Adobe Experience Manager) |

### Stencils batch 2

No new icon needs attribution (no CC-BY sources). Skipped for lack of a clean, permissive mark: Redpanda,
Honeycomb, Weaviate (wordmark only; covered by the generic Vector DB), Grafana Tempo, Azure Durable Functions
and Event Hubs Capture (no distinct icon). Kafka Streams reuses `kafka.svg`.

| Icon file                   | Source                                   | Original asset                                                                                                                             |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `azure-static-web-apps.svg` | Azure V24                                | `web/01007-icon-service-Static-Apps.svg`                                                                                                   |
| `azure-data-factory.svg`    | Azure V24                                | `analytics/10126-icon-service-Data-Factories.svg`                                                                                          |
| `azure-synapse.svg`         | Azure V24                                | `analytics/00606-icon-service-Azure-Synapse-Analytics.svg`                                                                                 |
| `aws-msk.svg`               | AWS 2026-07                              | `Arch_Analytics/48/Arch_Amazon-Managed-Streaming-for-Apache-Kafka_48.svg`                                                                  |
| `aws-mq.svg`                | AWS 2026-07                              | `Arch_Application-Integration/48/Arch_Amazon-MQ_48.svg`                                                                                    |
| `aws-redshift.svg`          | AWS 2026-07                              | `Arch_Analytics/48/Arch_Amazon-Redshift_48.svg`                                                                                            |
| `aws-aurora.svg`            | AWS 2026-07                              | `Arch_Databases/48/Arch_Amazon-Aurora_48.svg`                                                                                              |
| `gcp-dataflow.svg`          | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:dataflow`                                                                                                                             |
| `gcp-cloud-run.svg`         | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:cloud-run`                                                                                                                            |
| `gcp-cloud-functions.svg`   | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:cloud-functions`                                                                                                                      |
| `gcp-gke.svg`               | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:google-kubernetes-engine`                                                                                                             |
| `gcp-bigquery.svg`          | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:bigquery`                                                                                                                             |
| `gcp-spanner.svg`           | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:cloud-spanner`                                                                                                                        |
| `gcp-cloud-sql.svg`         | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:cloud-sql`                                                                                                                            |
| `gcp-firestore.svg`         | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:firestore`                                                                                                                            |
| `flink.svg`                 | gilbarbara/logos (CC0)                   | `logos:apache-flink-icon`                                                                                                                  |
| `temporal.svg`              | gilbarbara/logos (CC0)                   | `logos:temporal-icon`                                                                                                                      |
| `airflow.svg`               | gilbarbara/logos (CC0)                   | `logos:airflow-icon`                                                                                                                       |
| `vercel.svg`                | gilbarbara/logos (CC0)                   | `logos:vercel-icon`                                                                                                                        |
| `netlify.svg`               | gilbarbara/logos (CC0)                   | `logos:netlify-icon`                                                                                                                       |
| `cloudflare-workers.svg`    | gilbarbara/logos (CC0)                   | `logos:cloudflare-workers-icon`                                                                                                            |
| `envoy.svg`                 | gilbarbara/logos (CC0)                   | `logos:envoy-icon`                                                                                                                         |
| `linkerd.svg`               | gilbarbara/logos (CC0)                   | `logos:linkerd`                                                                                                                            |
| `supabase.svg`              | gilbarbara/logos (CC0)                   | `logos:supabase-icon`                                                                                                                      |
| `firebase.svg`              | gilbarbara/logos (CC0)                   | `logos:firebase-icon`                                                                                                                      |
| `pinecone.svg`              | gilbarbara/logos (CC0)                   | `logos:pinecone-icon`                                                                                                                      |
| `kibana.svg`                | gilbarbara/logos (CC0)                   | `logos:kibana`                                                                                                                             |
| `new-relic.svg`             | gilbarbara/logos (CC0)                   | `logos:new-relic-icon`                                                                                                                     |
| `sentry.svg`                | gilbarbara/logos (CC0)                   | `logos:sentry-icon`                                                                                                                        |
| `okta.svg`                  | gilbarbara/logos (CC0)                   | `logos:okta-icon`                                                                                                                          |
| `auth0.svg`                 | gilbarbara/logos (CC0)                   | `logos:auth0-icon`                                                                                                                         |
| `twilio.svg`                | gilbarbara/logos (CC0)                   | `logos:twilio-icon`                                                                                                                        |
| `sendgrid.svg`              | gilbarbara/logos (CC0)                   | `logos:sendgrid-icon`                                                                                                                      |
| `salesforce.svg`            | gilbarbara/logos (CC0)                   | `logos:salesforce`                                                                                                                         |
| `slack.svg`                 | gilbarbara/logos (CC0)                   | `logos:slack-icon`                                                                                                                         |
| `github.svg`                | gilbarbara/logos (CC0)                   | `logos:github-icon`                                                                                                                        |
| `openai.svg`                | gilbarbara/logos (CC0)                   | `logos:openai-icon`                                                                                                                        |
| `claude.svg`                | gilbarbara/logos (CC0)                   | `logos:claude-icon` (used for the Claude API)                                                                                              |
| `graphql.svg`               | gilbarbara/logos (CC0)                   | `logos:graphql`                                                                                                                            |
| `grpc.svg`                  | gilbarbara/logos (CC0)                   | `logos:grpc` (wordmark: gRPC has no standalone symbol)                                                                                     |
| `terraform.svg`             | gilbarbara/logos (CC0)                   | `logos:terraform-icon`                                                                                                                     |
| `argo.svg`                  | gilbarbara/logos (CC0)                   | `logos:argo-icon` (used for Argo CD)                                                                                                       |
| `pulsar.svg`                | Simple Icons (CC0)                       | `simple-icons:apachepulsar`, fill `#188FFF`                                                                                                |
| `camunda.svg`               | Simple Icons (CC0)                       | `simple-icons:camunda`, fill `#FC5D0D`                                                                                                     |
| `istio.svg`                 | Simple Icons (CC0)                       | `simple-icons:istio`, fill `#466BB0`                                                                                                       |
| `traefik.svg`               | Simple Icons (CC0)                       | `simple-icons:traefikproxy`, fill `#24A1C1`                                                                                                |
| `cassandra.svg`             | Simple Icons (CC0)                       | `simple-icons:apachecassandra`, fill `#1287B1`                                                                                             |
| `minio.svg`                 | Simple Icons (CC0)                       | `simple-icons:minio`, fill `#C72E49`                                                                                                       |
| `stripe.svg`                | Simple Icons (CC0)                       | `simple-icons:stripe`, fill `#635BFF`                                                                                                      |
| `hubspot.svg`               | Simple Icons (CC0)                       | `simple-icons:hubspot`, fill `#FF7A59`                                                                                                     |
| `haproxy.svg`               | Devicon (MIT)                            | `devicon:haproxy`                                                                                                                          |
| `clickhouse.svg`            | Devicon (MIT)                            | `devicon:clickhouse`                                                                                                                       |
| `loki.svg`                  | Devicon (MIT)                            | `devicon:grafanaloki`                                                                                                                      |
| `jaeger.svg`                | Devicon (MIT)                            | `devicon:jaegertracing`                                                                                                                    |
| `confluent.svg`             | theSVG (MIT)                             | `thesvg-color:confluent`; only the circular symbol is kept (viewBox cropped to it, wordmark path removed), as Confluent uses it standalone |
| `keycloak.svg`              | theSVG (MIT)                             | `thesvg-color:keycloak`                                                                                                                    |
| `microsoft-fabric.svg`      | theSVG (MIT)                             | `thesvg-color:microsoft-fabric`                                                                                                            |
| `generic-cdc.svg`           | Lucide (ISC)                             | `database-zap` (Debezium CDC: no permissively licensed Debezium logo found)                                                                |
| `generic-batch-job.svg`     | Lucide (ISC)                             | `layers`                                                                                                                                   |
| `generic-cdn.svg`           | Lucide (ISC)                             | `globe`                                                                                                                                    |
| `generic-dns.svg`           | Lucide (ISC)                             | `signpost`                                                                                                                                 |
| `generic-firewall.svg`      | Lucide (ISC)                             | `brick-wall-shield`                                                                                                                        |
| `client-team.svg`           | Lucide (ISC)                             | `users`                                                                                                                                    |
| `generic-push.svg`          | Lucide (ISC)                             | `bell-ring`                                                                                                                                |
| `generic-sms.svg`           | Lucide (ISC)                             | `message-square-text`                                                                                                                      |
| `generic-file.svg`          | Lucide (ISC)                             | `file-box`                                                                                                                                 |
| `generic-warehouse.svg`     | Lucide (ISC)                             | `warehouse`                                                                                                                                |
| `generic-cache.svg`         | Lucide (ISC)                             | `zap`                                                                                                                                      |
| `generic-search-index.svg`  | Lucide (ISC)                             | `text-search`                                                                                                                              |
| `generic-ml-model.svg`      | Lucide (ISC)                             | `brain-circuit`                                                                                                                            |
| `generic-external-api.svg`  | Lucide (ISC)                             | `cloud`                                                                                                                                    |
| `generic-llm.svg`           | Lucide (ISC)                             | `sparkles`                                                                                                                                 |
| `generic-vector-db.svg`     | Lucide (ISC)                             | `orbit`                                                                                                                                    |

### Config, secrets and identity (relationships, phase 1)

No new icon needs attribution. Parameter Store and IAM Role use AWS **resource** icons (the 2026-07-31
package's `Resource-Icons_07312026` set): Systems Manager's and IAM's service icons don't say which
feature it is. Azure Monitor (P2) is left for later.

| Icon file                       | Source                                   | Original asset                                                                                         |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `azure-app-config.svg`          | Azure V24                                | `integration/10219-icon-service-App-Configuration.svg`                                                 |
| `azure-managed-identity.svg`    | Azure V24                                | `identity/10227-icon-service-Managed-Identities.svg`                                                   |
| `aws-secrets-manager.svg`       | AWS 2026-07                              | `Arch_Security-Identity/48/Arch_AWS-Secrets-Manager_48.svg`                                            |
| `aws-cloudwatch.svg`            | AWS 2026-07                              | `Arch_Management-Tools/48/Arch_Amazon-CloudWatch_48.svg`                                               |
| `aws-parameter-store.svg`       | AWS 2026-07 (resource icon)              | `Res_Management-Governance/Res_AWS-Systems-Manager_Parameter-Store_48.svg`                             |
| `aws-iam-role.svg`              | AWS 2026-07 (resource icon)              | `Res_Security-Identity/Res_AWS-Identity-Access-Management_Role_48.svg`                                 |
| `gcp-secret-manager.svg`        | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:secret-manager`                                                                                   |
| `k8s-configmap.svg`             | Kubernetes community                     | https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/cm.svg     |
| `k8s-secret.svg`                | Kubernetes community                     | https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/secret.svg |
| `generic-config-store.svg`      | Lucide (ISC)                             | `file-sliders`                                                                                         |
| `generic-secret-store.svg`      | Lucide (ISC)                             | `vault`                                                                                                |
| `generic-identity-provider.svg` | Lucide (ISC)                             | `fingerprint`                                                                                          |

The relationship glyphs drawn on edges, in menus and in node pips (`src/components/relationGlyphs.ts`)
are Lucide (ISC) paths, each flattened to one stroked path on the 24 px grid: `sliders-horizontal`
(Config), `key-round` (Secret), `id-card` (Identity), `activity` (Telemetry), `rocket` (Deploys), `link-2`
(Depends on), `lock` (a secret setting) and `lock-open` (a plain one, in the inspector). Message, Request and the menu's Relationship glyph are drawn
for this app.

### Stencils batch 3 (scenario examples)

Added for the data-platform, pattern and multi-region examples. No new icon needs attribution. Skipped for
lack of a clean, permissive mark: Fivetran, Hightouch, Census, Braze and Customer.io (covered by the generic
Reverse ETL and Marketing Automation stencils, and Airbyte for ELT). Snowpipe Streaming reuses `snowflake.svg`.

| Icon file                      | Source                                   | Original asset                                                    |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------- |
| `aws-route53.svg`              | AWS 2026-07                              | `Arch_Networking-Content-Delivery/48/Arch_Amazon-Route-53_48.svg` |
| `azure-traffic-manager.svg`    | Azure V24                                | `networking/10065-icon-service-Traffic-Manager-Profiles.svg`      |
| `gcp-cloud-storage.svg`        | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:cloud-storage`                                               |
| `gcp-cloud-load-balancing.svg` | Google Cloud (Iconify `gcp`), Apache-2.0 | `gcp:cloud-load-balancing`                                        |
| `dbt.svg`                      | gilbarbara/logos (CC0)                   | `logos:dbt-icon`                                                  |
| `looker.svg`                   | gilbarbara/logos (CC0)                   | `logos:looker-icon`                                               |
| `tableau.svg`                  | gilbarbara/logos (CC0)                   | `logos:tableau-icon`                                              |
| `airbyte.svg`                  | Simple Icons (CC0)                       | `simple-icons:airbyte`, fill `#615EFF`                            |
| `generic-event-store.svg`      | Lucide (ISC)                             | `scroll-text`                                                     |
| `generic-projection.svg`       | Lucide (ISC)                             | `projector`                                                       |
| `generic-saga.svg`             | Lucide (ISC)                             | `workflow`                                                        |
| `generic-rate-limiter.svg`     | Lucide (ISC)                             | `gauge`                                                           |
| `generic-marketing.svg`        | Lucide (ISC)                             | `megaphone` (marketing automation: Braze, Customer.io, Iterable)  |
| `generic-reverse-etl.svg`      | Lucide (ISC)                             | `arrow-left-right` (reverse ETL: Hightouch, Census)               |

### Imports batch 1 (docker-compose)

No new icon needs attribution. MariaDB images use the MySQL stencil.

| Icon file   | Source                 | Original asset     |
| ----------- | ---------------------- | ------------------ |
| `mysql.svg` | gilbarbara/logos (CC0) | `logos:mysql-icon` |
