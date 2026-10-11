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
Foundation, HashiCorp, Splunk/Cisco, etc.). They're used **nominatively**, only to show those
products in architecture diagrams. This doesn't imply any affiliation with or endorsement by
the trademark owners. Don't alter the logos beyond scaling, and don't use them as the app's own branding.

The CC-BY-4.0 `entra-id.svg` (selfh.st) needs attribution. Keep this file, or add a credits
line in the app, when distributing.

### Added later

| Icon file   | Source                 | Original asset                                         |
| ----------- | ---------------------- | ------------------------------------------------------ |
| `kong.svg`  | gilbarbara/logos (CC0) | `logos:kong-icon`                                      |
| `adobe.svg` | gilbarbara/logos (CC0) | `logos:adobe-icon` (used for Adobe Experience Manager) |
