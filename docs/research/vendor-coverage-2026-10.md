# Vendor coverage — October 2026

## Scope and selection

Research recorded 2026-10-23 before implementation. 58 additions, at most five per functional category (database subtypes are separate functional categories). Keep the nine existing panel categories. Category descriptions reuse existing translated wording; Fastly Compute uses the neutral serverless-function description, and Redpanda uses the partitioned-log description. Brand names are untranslated. Prefer the largest missing products where comparable evidence exists; label coverage choices and weak evidence explicitly. There is no defensible single global ranking across these markets. Do not infer vendor quotas, performance or CDN caching from popularity. Brand names are nominative; accents identify vendors without claiming endorsement.

## Existing panel inventory

- **messaging**: Apache Kafka, Azure, RabbitMQ, AWS, Google Cloud, NATS, Redis, Confluent, Debezium, Apache Pulsar, MQTT.
- **compute**: Azure, AWS, Kubernetes, Docker, .NET, Java, Node.js, Python, Go, Apache Flink, Google Cloud, Temporal, Camunda, Apache Airflow, Vercel, Netlify, Cloudflare, GraphQL, gRPC.
- **data**: PostgreSQL, MySQL, Microsoft, Azure, MongoDB, Redis, Elastic, AWS, Snowflake, Adobe, Databricks, Google Cloud, Apache Cassandra, ClickHouse, Supabase, MinIO, Pinecone, dbt Labs, Airbyte, Generic, Tableau.
- **network**: Azure, AWS, NGINX, Kong, Cloudflare, Generic, Envoy, Istio, Linkerd, Traefik, HAProxy, Google Cloud.
- **onprem**: Generic, Cisco, Juniper, Arista, HPE Aruba, Palo Alto Networks, Fortinet, Check Point, F5, NetScaler.
- **observability**: Grafana Labs, Prometheus, Datadog, Azure, OpenTelemetry, Splunk, Jaeger, Elastic, New Relic, Sentry, AWS.
- **security**: Azure, Microsoft, HashiCorp, Okta, Keycloak, AWS, Google Cloud, Kubernetes.
- **clients**: Client, React, Vue, Angular, Svelte, Next.js, Nuxt, React Native, Flutter, SwiftUI (iOS), Jetpack Compose (Android), Generic, Iterable, Braze, Segment, Shopify, PayPal, Adyen, Stripe, Twilio, Salesforce, HubSpot, Slack, GitHub, OpenAI, Anthropic.
- **generic**: Generic, GitHub, HashiCorp, Argo.

## CDN and edge

Current: Cloudflare; Azure Front Door.

Evidence: [W3Techs reverse proxies, daily snapshot, accessed 2026-10-23](https://w3techs.com/technologies/overview/proxy). CloudFront, Fastly and Akamai are the largest missing general delivery networks in the reverse-proxy measurement. Bunny adds a visible independent CDN; Google completes the major-cloud coverage. Azure Front Door already exists; no duplicate. Google is a cloud-coverage selection, not a claimed fifth-place CDN.

| Proposed stencil  | ID               | Behavioural parent | Panel   | Simulation role |
| ----------------- | ---------------- | ------------------ | ------- | --------------- |
| Fastly            | `fastly`         | `generic.cdn`      | network | gateway         |
| Akamai CDN        | `akamai`         | `generic.cdn`      | network | gateway         |
| Amazon CloudFront | `aws.cloudfront` | `generic.cdn`      | network | gateway         |
| Bunny CDN         | `bunny.cdn`      | `generic.cdn`      | network | gateway         |
| Google Cloud CDN  | `gcp.cloud-cdn`  | `generic.cdn`      | network | gateway         |

## WAF and DDoS

Current: Cloudflare (combined edge); generic Firewall / WAF; on-prem firewalls.

Evidence: [W3Techs reverse proxies, daily snapshot, accessed 2026-10-23](https://w3techs.com/technologies/overview/proxy). Cloudflare, Akamai, Sucuri and Imperva have visible edge installed bases. AWS WAF adds the major-cloud option. Proxy share is a proxy for reach, not a WAF-specific share or evidence of a security subscription.

| Proposed stencil           | ID                         | Behavioural parent | Panel   | Simulation role |
| -------------------------- | -------------------------- | ------------------ | ------- | --------------- |
| Cloudflare WAF             | `cloudflare.waf`           | `generic.firewall` | network | gateway         |
| AWS WAF                    | `aws.waf`                  | `generic.firewall` | network | gateway         |
| Akamai App & API Protector | `akamai.app-api-protector` | `generic.firewall` | network | gateway         |
| Imperva WAF                | `imperva.waf`              | `generic.firewall` | network | gateway         |
| Sucuri WAF                 | `sucuri.waf`               | `generic.firewall` | network | gateway         |

## DNS

Current: Route 53; Azure Traffic Manager; generic DNS.

Evidence: [W3Techs DNS, daily snapshot, accessed 2026-10-23](https://w3techs.com/technologies/overview/dns_server). The measurement leads with Cloudflare, GoDaddy, Hostinger and United Internet (represented by IONOS). Google is selected for managed cloud DNS; parent-company shares do not isolate Cloud DNS. Wix and Newfold are primarily hosting-site coverage and are deferred.

| Proposed stencil | ID               | Behavioural parent | Panel   | Simulation role |
| ---------------- | ---------------- | ------------------ | ------- | --------------- |
| Cloudflare DNS   | `cloudflare.dns` | `generic.dns`      | network | gateway         |
| GoDaddy DNS      | `godaddy.dns`    | `generic.dns`      | network | gateway         |
| Hostinger DNS    | `hostinger.dns`  | `generic.dns`      | network | gateway         |
| IONOS DNS        | `ionos.dns`      | `generic.dns`      | network | gateway         |
| Google Cloud DNS | `gcp.cloud-dns`  | `generic.dns`      | network | gateway         |

## Load balancers and API gateways

Current: Azure API Management, Front Door and Application Gateway; AWS API Gateway and ELB; Google Cloud Load Balancing; NGINX, Kong, Envoy, HAProxy, Traefik; F5 and NetScaler on-prem.

Evidence: [Apache APISIX adoption analysis, 2025-02-06, accessed 2026-10-23](https://apisix.apache.org/blog/2025/02/06/analyzing-api-gateway-adoption-rates/); [Enlyft API management installed base, accessed 2026-10-23](https://enlyft.com/tech/api-management). Existing coverage includes the main load-balancer options. Apigee and APISIX fill the missing API gateway coverage, supported by installed-base and adoption measurements; no new load-balancer simulation.

| Proposed stencil | ID           | Behavioural parent     | Panel   | Simulation role |
| ---------------- | ------------ | ---------------------- | ------- | --------------- |
| Apigee           | `gcp.apigee` | `azure.api-management` | network | gateway         |
| Apache APISIX    | `apisix`     | `kong`                 | network | gateway         |

## Message brokers and streaming

Current: Kafka, Confluent, RabbitMQ, NATS, Pulsar, MQTT, Redis Streams; Azure Service Bus/Event Hubs/Event Grid/Storage Queue; AWS SQS/SNS/EventBridge/Kinesis/MSK/MQ; Google Pub/Sub.

Evidence: [CNCF landscape guide, living inventory, accessed 2026-10-23](https://landscapeapp.cncf.io/cncf/guide). Most established options already exist. ActiveMQ and Redpanda fill conventional queue and Kafka-compatible log gaps. [Redpanda customer deployments (accessed 2026-10-23)](https://www.redpanda.com/customers) provide additional evidence of real production use. CNCF is an ecosystem inventory, not a market-share ranking; these are coverage selections with lower ranking confidence.

| Proposed stencil | ID               | Behavioural parent    | Panel     | Simulation role |
| ---------------- | ---------------- | --------------------- | --------- | --------------- |
| ActiveMQ         | `activemq.queue` | `generic.queue`       | messaging | queue           |
| Redpanda         | `redpanda.topic` | `generic.event-store` | messaging | stream          |

## Relational databases

Current: PostgreSQL, MySQL, SQL Server, Azure SQL, Aurora, Cloud SQL, Spanner, Supabase.

Evidence: [Stack Overflow Developer Survey 2026, accessed 2026-10-23](https://survey.stackoverflow.co/2026/technology); [DB-Engines October 2026 ranking (search-index snapshot; live page timed out), accessed 2026-10-23](https://db-engines.com/en/ranking). SQLite, MariaDB and Oracle are the missing products in the 2026 survey database top ten. Select these before less-used relational engines.

| Proposed stencil | ID                | Behavioural parent | Panel | Simulation role |
| ---------------- | ----------------- | ------------------ | ----- | --------------- |
| SQLite           | `sqlite`          | `generic.database` | data  | store           |
| MariaDB          | `mariadb`         | `generic.database` | data  | store           |
| Oracle Database  | `oracle.database` | `generic.database` | data  | store           |

## NoSQL databases

Current: MongoDB, Cassandra, DynamoDB, Cosmos DB, Firestore, Firebase.

Evidence: [DB-Engines October 2026 ranking (search-index snapshot; live page timed out), accessed 2026-10-23](https://db-engines.com/en/ranking). Couchbase fills a prominent document/key-value gap in the database popularity inventory. Popularity scores are visibility signals, not production installed-base percentages.

| Proposed stencil | ID          | Behavioural parent | Panel | Simulation role |
| ---------------- | ----------- | ------------------ | ----- | --------------- |
| Couchbase        | `couchbase` | `mongodb`          | data  | store           |

## Cache databases

Current: Redis; Azure Redis; generic Cache.

Evidence: [DB-Engines October 2026 ranking (search-index snapshot; live page timed out), accessed 2026-10-23](https://db-engines.com/en/ranking). Memcached is the established missing cache; Valkey adds the Redis-compatible ecosystem fork. Do not duplicate Redis under another hosting vendor.

| Proposed stencil | ID          | Behavioural parent | Panel | Simulation role |
| ---------------- | ----------- | ------------------ | ----- | --------------- |
| Memcached        | `memcached` | `generic.cache`    | data  | store           |
| Valkey           | `valkey`    | `generic.cache`    | data  | store           |

## Search databases

Current: Elasticsearch; generic Search Index.

Evidence: [DB-Engines October 2026 ranking (search-index snapshot; live page timed out), accessed 2026-10-23](https://db-engines.com/en/ranking). Solr and OpenSearch fill the principal missing dedicated search products. No search query semantics are added.

| Proposed stencil | ID           | Behavioural parent     | Panel | Simulation role |
| ---------------- | ------------ | ---------------------- | ----- | --------------- |
| OpenSearch       | `opensearch` | `generic.search-index` | data  | store           |
| Apache Solr      | `solr`       | `generic.search-index` | data  | store           |

## Time-series databases

Current: Prometheus (observability); generic Database; ClickHouse (analytics).

Evidence: [DB-Engines October 2026 ranking (search-index snapshot; live page timed out), accessed 2026-10-23](https://db-engines.com/en/ranking). The [DB-Engines time-series ranking, October 2026 (accessed 2026-10-23)](https://db-engines.com/en/ranking/time%2Bseries%2Bdbms) lists InfluxDB and TimescaleDB. They cover dedicated time-series storage choices; retain generic store behaviour. Existing Prometheus remains telemetry, rather than being duplicated as a database.

| Proposed stencil | ID            | Behavioural parent | Panel | Simulation role |
| ---------------- | ------------- | ------------------ | ----- | --------------- |
| InfluxDB         | `influxdb`    | `generic.database` | data  | store           |
| TimescaleDB      | `timescaledb` | `generic.database` | data  | store           |

## Vector databases

Current: Pinecone; generic Vector DB; PostgreSQL (general database).

Evidence: [DB-Engines vector ranking, October 2026, accessed 2026-10-23](https://db-engines.com/en/ranking/vector%2Bdbms). Milvus, Qdrant and Weaviate appear in the dedicated-vector ranking. Reuse Vector DB storage behaviour; pgvector remains a PostgreSQL alias candidate for later.

| Proposed stencil | ID         | Behavioural parent  | Panel | Simulation role |
| ---------------- | ---------- | ------------------- | ----- | --------------- |
| Milvus           | `milvus`   | `generic.vector-db` | data  | store           |
| Qdrant           | `qdrant`   | `generic.vector-db` | data  | store           |
| Weaviate         | `weaviate` | `generic.vector-db` | data  | store           |

## Object storage

Current: S3; Azure Blob Storage; Google Cloud Storage; MinIO; Adobe AEM.

Evidence: [Cloudflare developer platform adoption, 2026-10-20, accessed 2026-10-23](https://www.cloudflare.com/press/press-releases/2026/more-than-10-million-developers-are-building-on-cloudflare/). The three large clouds and self-hosted S3 already exist. R2, B2 and Wasabi are the focused independent-cloud shortlist. R2 has current platform adoption evidence; that total does not measure R2 alone. [Backblaze quarterly results (2026, accessed 2026-10-23)](https://ir.backblaze.com/financials/quarterly-results/default.aspx) report B2 customer adoption, while [Wasabi’s 2025 customer review (accessed 2026-10-23)](https://wasabi.com/blog/data-management/data-stories-from-2025-what-our-customers-taught-us-about-cloud-storage) documents deployed use across industries. Comparable public B2/Wasabi shares were not established; treat them as coverage choices, not a numerical top-three claim.

| Proposed stencil | ID              | Behavioural parent | Panel | Simulation role |
| ---------------- | --------------- | ------------------ | ----- | --------------- |
| Cloudflare R2    | `cloudflare.r2` | `generic.file`     | data  | store           |
| Backblaze B2     | `backblaze.b2`  | `generic.file`     | data  | store           |
| Wasabi           | `wasabi`        | `generic.file`     | data  | store           |

## Observability

Current: Grafana, Prometheus, Datadog, Application Insights, Splunk, Loki, Jaeger, Kibana, New Relic, Sentry, CloudWatch; OpenTelemetry Collector.

Evidence: [Grafana Observability Survey 2026, 1,363 respondents, accessed 2026-10-23](https://grafana.com/observability-survey/); [Gartner Observability Platforms, 2025-07-07, accessed 2026-10-23](https://www.gartner.com/en/documents/6688834). Tempo fills tracing and Dynatrace/Elastic APM fill application monitoring. Metrics and logs already have extensive coverage. The Grafana survey has community-selection bias; Gartner inclusion is not installed-base share.

| Proposed stencil | ID              | Behavioural parent | Panel         | Simulation role |
| ---------------- | --------------- | ------------------ | ------------- | --------------- |
| Dynatrace        | `dynatrace`     | `datadog`          | observability | sink            |
| Elastic APM      | `elastic.apm`   | `datadog`          | observability | sink            |
| Grafana Tempo    | `grafana.tempo` | `jaeger`           | observability | sink            |

## Identity and auth

Current: Entra ID, Okta, Auth0, Keycloak; cloud workload identities; generic Identity Provider.

Evidence: [Enlyft identity installed base, accessed 2026-10-23](https://enlyft.com/tech/identity-access-management); [Ramp Clerk adoption, October 2026, accessed 2026-10-23](https://ramp.com/vendors/clerk); [Brandwave authentication search demand, year ending September 2026, accessed 2026-10-23](https://gobrandwave.com/demand/global-en/categories/authentication-platforms). Cognito has measured installed-base coverage; Clerk has current purchasing adoption. Firebase Authentication is a distinct identity service from the existing Firebase database. Search demand supports discovery only, not production market share.

| Proposed stencil        | ID              | Behavioural parent          | Panel    | Simulation role |
| ----------------------- | --------------- | --------------------------- | -------- | --------------- |
| Amazon Cognito          | `aws.cognito`   | `generic.identity-provider` | security | none            |
| Firebase Authentication | `firebase.auth` | `generic.identity-provider` | security | none            |
| Clerk                   | `clerk`         | `generic.identity-provider` | security | none            |

## Payments

Current: Stripe, PayPal, Adyen, Shopify (commerce API).

Evidence: [6sense payment management installed base, accessed 2026-10-23](https://6sense.com/tech/payment-management/braintree-market-share). Square and Braintree fill widely deployed checkout integrations. Venmo is part of the PayPal family and is deferred rather than duplicating another wallet integration.

| Proposed stencil | ID          | Behavioural parent     | Panel   | Simulation role |
| ---------------- | ----------- | ---------------------- | ------- | --------------- |
| Square           | `square`    | `generic.external-api` | clients | sink            |
| Braintree        | `braintree` | `generic.external-api` | clients | sink            |

## Email, SMS and push

Current: Twilio, SendGrid, Iterable, Braze, Slack; SNS; generic Email/SMS/Push.

Evidence: [Enlyft transactional email installed base, accessed 2026-10-23](https://enlyft.com/tech/transactional-email); [6sense push notification installed base, accessed 2026-10-23](https://6sense.com/tech/push-notifications). Mailgun, SES and Postmark have measured transactional-email installed bases. OneSignal leads the measured push category; Firebase Cloud Messaging completes common mobile push coverage. SMS already has Twilio; avoid inventing another SMS behaviour.

| Proposed stencil         | ID             | Behavioural parent | Panel   | Simulation role |
| ------------------------ | -------------- | ------------------ | ------- | --------------- |
| Amazon SES               | `aws.ses`      | `generic.email`    | clients | sink            |
| Mailgun                  | `mailgun`      | `generic.email`    | clients | sink            |
| Postmark                 | `postmark`     | `generic.email`    | clients | sink            |
| OneSignal                | `onesignal`    | `generic.push`     | clients | sink            |
| Firebase Cloud Messaging | `firebase.fcm` | `generic.push`     | clients | sink            |

## Feature flags

Current: Azure App Configuration; generic Config Store.

Evidence: [Similarweb LaunchDarkly adoption, 2026-07-22, accessed 2026-10-23](https://www.similarweb.com/technology/launch-darkly/); [StackScope new-site feature flag adoption, accessed 2026-10-23](https://stackscope.dev/tech/unleash). LaunchDarkly has a substantial detected web footprint; Unleash and Statsig appear in new-site flag adoption. New-site detection is a narrow sample and cannot establish global rank. All remain configuration dependencies.

| Proposed stencil | ID             | Behavioural parent     | Panel    | Simulation role |
| ---------------- | -------------- | ---------------------- | -------- | --------------- |
| LaunchDarkly     | `launchdarkly` | `generic.config-store` | security | none            |
| Unleash          | `unleash`      | `generic.config-store` | security | none            |
| Statsig          | `statsig`      | `generic.config-store` | security | none            |

## CI/CD

Current: GitHub Actions; Argo CD; Terraform.

Evidence: [6sense CI/CD installed base, accessed 2026-10-23](https://6sense.com/tech/continuos-integration). Jenkins and CircleCI extend CI/CD coverage; GitLab fills the integrated source-and-pipeline platform gap. GitLab is a coverage selection because this source splits related products unevenly. Bitbucket is deferred under the batch cap.

| Proposed stencil | ID          | Behavioural parent | Panel   | Simulation role |
| ---------------- | ----------- | ------------------ | ------- | --------------- |
| GitLab CI/CD     | `gitlab.ci` | `github-actions`   | compute | source          |
| Jenkins          | `jenkins`   | `github-actions`   | compute | source          |
| CircleCI         | `circleci`  | `github-actions`   | compute | source          |

## Serverless and edge compute

Current: Lambda, Azure Functions, Google Cloud Functions/Run, Container Apps; Cloudflare Workers; Vercel, Netlify.

Evidence: [Datadog State of Serverless, August 2023 (historical context only), accessed 2026-10-23](https://www.datadoghq.com/state-of-serverless/); [Cloudflare developer platform adoption, 2026-10-20, accessed 2026-10-23](https://www.cloudflare.com/press/press-releases/2026/more-than-10-million-developers-are-building-on-cloudflare/); [W3Techs reverse proxies, daily snapshot, accessed 2026-10-23](https://w3techs.com/technologies/overview/proxy). Fastly Compute is the missing compute service from a CDN already selected here. Historical serverless research confirms the product class; current CDN reach does not establish Compute market share. Existing providers already cover the leading cloud choices.

| Proposed stencil | ID               | Behavioural parent   | Panel   | Simulation role |
| ---------------- | ---------------- | -------------------- | ------- | --------------- |
| Fastly Compute   | `fastly.compute` | `cloudflare.workers` | compute | processor       |

## AI/LLM APIs

Current: OpenAI; Anthropic Claude; generic LLM and ML Model.

Evidence: [OpenRouter usage rankings, week beginning 2026-10-12, accessed 2026-10-23](https://openrouter.ai/rankings); [Stack Overflow Developer Survey 2026, accessed 2026-10-23](https://survey.stackoverflow.co/2026/technology). Google Gemini and Mistral add visible model-provider options; Bedrock adds managed AWS inference. OpenRouter measures its own routed traffic, not all direct APIs. Bedrock is a distribution-platform coverage selection, not a model-author ranking.

| Proposed stencil  | ID              | Behavioural parent | Panel   | Simulation role |
| ----------------- | --------------- | ------------------ | ------- | --------------- |
| Google Gemini API | `google.gemini` | `generic.llm`      | clients | processor       |
| Amazon Bedrock    | `aws.bedrock`   | `generic.llm`      | clients | processor       |
| Mistral AI API    | `mistral.api`   | `generic.llm`      | clients | processor       |

## Behaviour contracts

Gateway is the existing pass-through processor role; queue/stream retain the existing broker roles, and none marks a dependency outside message flow. Use these actual contracts rather than collapsing them into source/processor/store/sink. Where no neutral equivalent exists, use the existing category representative (API Management, Kong, MongoDB, Datadog, Jaeger, GitHub Actions or Cloudflare Workers), without copying vendor-specific quota presets. New vendor stencils must match their parent for defaults, props, wait behaviour, relations, reinference and export shape. All icons reuse neutral category glyphs from the existing asset pipeline; their per-stencil licence records will be in docs/ICONS.md.

## Later

CDN: additional regional networks and DDoS-Guard; WAF: Azure WAF, Google Cloud Armor, Fastly Next-Gen WAF; DNS: Wix, Newfold, Namecheap, OVHcloud and Azure DNS; gateways: MuleSoft, Tyk, Gravitee; messaging: RocketMQ, EMQX and HiveMQ (existing MQTT Broker already represents the latter two); relational: Db2; NoSQL: CouchDB; time-series: QuestDB and VictoriaMetrics; vector: Chroma, LanceDB and pgvector; object storage: DigitalOcean Spaces and IBM Cloud Object Storage; observability: Honeycomb and Zipkin; identity: Ping Identity; payments: Checkout.com, Worldpay and Razorpay; messaging: Brevo and Vonage; feature flags: Flagsmith, GrowthBook and Harness; CI/CD: Bitbucket Pipelines, Azure Pipelines and Buildkite; edge compute: CloudFront Functions and Deno Deploy; AI: DeepSeek, Cohere and Groq. These are candidates for a subsequent evidence pass, not claims of equal popularity.

Rejected: a new category/filter for every vendor, unlicensed brand artwork, invented CDN cache-hit behaviour, vendor throughput/latency claims, and automatic conversion of old diagrams.
