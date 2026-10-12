# Imports from infrastructure and specs

Research and plan, October 2026. Nothing here is built yet. Sample inputs are in `tests/fixtures/imports/`.

## Summary

Teams already describe their systems in files: AsyncAPI documents, docker-compose files, Kubernetes manifests and
Terraform. Live Diagrams should turn those into a diagram that is ready to **Go live**: real stencils, message
flows with typed messages, dependencies for config, secrets and identity, boundaries, and a tidy layout.
Everything is read on this device.

**Recommendation.**

- **Open them like any other file.** Open…, drop and Paste text all work, several files at once. The text is
  recognised by a cheap sniff that stays in the startup bundle (under 1 kB). The reader for each format is a lazy
  chunk.
- **One pipeline for every source.** Each reader builds a small intermediate graph (components, links,
  boundaries, and the evidence for each). Shared code then maps it to stencils and relationships, lays it out,
  and runs it through `validateDiagram`, like the draw.io and Mermaid converters.
- **Nothing is dropped silently.** What the importer couldn't place goes on a generic stencil. What it chose not
  to draw (a PodDisruptionBudget, a dev-only profile) is listed. Both appear in an **Import report**, opened from
  the import toast's **Details**. Guesses there come with one-click stencil chips.

**Order, by value per effort:**

1. **docker-compose.** The simplest input, and the most common.
2. **AsyncAPI 2.x and 3.x.** The closest fit to what this app is for: channels, producers, consumers and typed
   messages map straight onto the simulation's `emits` and `filter`. Several files join on the channel address
   into one system.
3. **Kubernetes manifests**, including KEDA and Strimzi, which are cheap and say who consumes which topic.
4. **Terraform `terraform show -json`** plan or state. Plain JSON, so no new dependency.

**Terraform HCL is not proposed now.** Every complete HCL parser that runs in a browser is WebAssembly or
GopherJS at 100 kB to 1.7 MB gzip. The WebAssembly ones would also need `'wasm-unsafe-eval'` in our
Content-Security-Policy.

**Libraries.** Only a YAML parser is new: **`yaml`** (eemeli, ISC), 30 kB gzip in a lazy chunk. Its alias
limit counts how far aliases _expand_, so a "billion laughs" file fails in 2 ms. js-yaml 5 is smaller (13.6 kB),
but its alias limit only counts aliases, and it parses our bomb fixture without complaint. The official AsyncAPI
parser is ruled out: 401 kB gzip, and it compiles schemas with `new Function`, which our CSP forbids. The entry
chunk (about 107.5 kB of the 123.5 kB budget) grows only by the sniffers.

## What each source can tell us

| Source                          | Gives us                                                                                                                                                                                 | Doesn't say                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **AsyncAPI**                    | Channels (topics, queues), which application sends or receives on each, message names, content types (Avro), brokers and protocols, partitions, consumer groups                          | Only one application per document, so other producers and consumers come from other files. No rates. No databases |
| **docker-compose**              | Services, images (so stencils: postgres, redis, kafka…), `depends_on`, networks, published ports, replicas, environment variable _names and hosts_                                       | Direction of traffic, topics (unless named in variables), anything outside the file                               |
| **Kubernetes**                  | Workloads, images, replicas, Services (selectors), Ingress routes, ConfigMaps and Secrets (as dependencies, with key names), namespaces, KEDA triggers (topic and group), Strimzi topics | Who calls whom (only hints from environment variables), managed cloud services outside the cluster                |
| **Terraform** (plan/state JSON) | Every cloud resource with its type and attributes, modules. Subscriptions, event-source mappings and targets are resources too, so they give real flow edges                             | Service-to-service calls inside compute; hundreds of resource types are noise                                     |

## How others do it

| Tool                                         | Input                                         | What it draws, and how                                                                                                                                                                                                                                        | Unknowns                                                             | Where it parses         |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| **AsyncAPI Studio** visualiser               | One AsyncAPI doc                              | Three columns: the channels it receives on → one application node → the channels it sends on. React Flow ([source][studio-nodes])                                                                                                                             | —                                                                    | Browser                 |
| **EventCatalog** AsyncAPI generator          | AsyncAPI docs                                 | One document is one service. `send` owns a message; `receive` references it. Overridable with `x-eventcatalog-role` ([docs][eventcatalog]). Commercial use needs a licence                                                                                    | —                                                                    | Build time              |
| **Structurizr**                              | DSL                                           | No AsyncAPI, Kubernetes or Terraform importer: "you will need to write some code" ([docs][sz-authoring]). Graphviz layout                                                                                                                                     | —                                                                    | Java                    |
| **IcePanel**                                 | Structurizr JSON, Backstage, its own YAML     | Imports the model only; it "does not create the corresponding diagrams" ([docs][icepanel-import])                                                                                                                                                             | —                                                                    | SaaS                    |
| **KubeDiagrams**                             | Manifests, kustomize, Helm output, live state | Four edge kinds: reference, selector, owner, network policy. Clusters by namespace, then by `app.kubernetes.io/*` labels. Per-kind rules in a YAML config: Service selectors, Ingress backends, env/envFrom, volumes, `scaleTargetRef` ([repo][kubediagrams]) | CRDs need a config file                                              | Local Python + Graphviz |
| **KubeView**, **k8sviz**, **Lens** map       | Live cluster                                  | Ownership and selector edges, live                                                                                                                                                                                                                            | —                                                                    | Need cluster access     |
| **docker-compose-viz**, `compose alpha viz`  | Compose file                                  | `depends_on`, links, `volumes_from`, networks and ports as nodes. Graphviz ([repo][dcv], [Docker][compose-viz])                                                                                                                                               | —                                                                    | Local CLI               |
| **kompose**                                  | Compose                                       | Converts to Kubernetes; `depends_on` and `links` aren't converted ([matrix][kompose])                                                                                                                                                                         | —                                                                    | Local CLI               |
| **`terraform graph`**                        | Config dir                                    | DOT. Since 1.7, only resource ordering by default ([docs][tf-graph])                                                                                                                                                                                          | Everything is drawn                                                  | Local                   |
| **Inframap**                                 | tfstate or HCL                                | Per provider: a whitelist of node types (43 on AWS), and edges only from security groups, collapsed node → SG → SG → node ([source][inframap-aws])                                                                                                            | Other providers: everything, unsimplified. Unconnected nodes dropped | Local Go CLI            |
| **Rover**, **Blast Radius**, **Terravision** | Plan JSON / TF dir                            | Resource graphs. Terravision nests by VPC, subnet and resource group and knows about 900 types (AGPL) ([repo][terravision])                                                                                                                                   | —                                                                    | Local server            |
| **Pluralith**                                | TF plan                                       | Change highlighting and cost. Private alpha, dormant since 2023 ([org][pluralith])                                                                                                                                                                            | —                                                                    | CLI + hosted            |
| **Brainboard**                               | .tf, Git repo; cloud scan                     | "Reverse Terraform" into a diagram plus code ([note][brainboard])                                                                                                                                                                                             | —                                                                    | SaaS                    |
| **Cloudcraft**, **Hava**                     | Live AWS/Azure/GCP accounts                   | Auto-generated diagrams ([Cloudcraft][cloudcraft], [Hava][hava]). No Terraform import found                                                                                                                                                                   | —                                                                    | SaaS, needs credentials |
| **draw.io**                                  | —                                             | Arrange ▸ Insert: Mermaid, CSV, SQL. No infrastructure import ([docs][drawio-insert])                                                                                                                                                                         | —                                                                    | —                       |

**What to take from them**

1. **Nobody draws flows from these files.** The Kubernetes and Terraform tools draw _resource_ graphs: ownership,
   selectors, security groups. The compose tools draw `depends_on`. The AsyncAPI tools draw one application at a
   time. Nobody joins several AsyncAPI documents into a system, or infers connections from environment variables:
   the research found no project that reads `DATABASE_URL=postgres://db:5432` as an edge to `db`
   ([composegraph][composegraph] and diagrams-js use `depends_on`, links and networks only). That's the gap. It
   suits an app whose diagrams _run_.
2. **Whitelist, then report.** Inframap's per-provider whitelist is what makes Terraform readable. Its failure mode
   is that it silently drops everything else. We keep the whitelist and list what's left out.
3. **"Glue" resources are edges.** Inframap collapses security-group chains into node-to-node edges. For messaging,
   the glue is better: an `aws_sns_topic_subscription`, an `aws_lambda_event_source_mapping` or a
   `google_pubsub_subscription` _is_ a message flow.
4. **Everything local.** All the good open tools run locally. The SaaS ones need cloud credentials or uploads. We
   need neither.
5. **Layout is the hard part.** Everyone leans on Graphviz. Our layered layout (`src/editor/layout.ts`) plus
   boundary-aware placement is enough, provided the importer lays out each boundary, then the boundaries.

## Design

### Pipeline

```
text(s) ─ sniff (entry, <1 kB) ─▶ lazy reader per format ─▶ ImportGraph ─▶ map ─▶ layout ─▶ validateDiagram ─▶ new diagram
                                    (yaml chunk shared)        components, links,     stencils,   boundaries   (one validator
                                                               groups, evidence,      relations   first        for everything)
                                                               report entries
```

- **`ImportGraph`** (`src/interop/infra/graph.ts`): components `{ key, label, hint: { image?, kind?, words? },
group?, props? }`, links `{ from, to, relation, kind?, props?, evidence }`, groups, and report entries. Readers
  only describe what they found. Shared code turns hints into stencils (`resolveStencil`, below), links into
  relationships, and groups into boundaries. Each reader is unit-tested from fixture to graph, and the mapping from
  graph to diagram.
- **Sniffing** (`src/interop/sniff.ts`, in the entry). Regexes on the first 4,000 characters:
  - `^asyncapi:\s*['"]?[23]\.` (or `"asyncapi": "2…"`/`"3…"` in JSON): AsyncAPI.
  - `^apiVersion:` with `^kind:`, or a `kind: List`: Kubernetes.
  - A top-level `^services:` with no `apiVersion`: Compose.
  - JSON with `"format_version"` and `"terraform_version"`: a Terraform plan or state.
  - `{{` with `.Values` or `include "`: a Helm template, refused with a hint.

  `detectFormat` reads JSON's top-level keys instead of "starts with `{` means native".

- **Several files at once.** Open… gets `multiple`, and a drop takes every file. Files are grouped by format.
  A group becomes **one** diagram: a Kubernetes manifest set, several AsyncAPI documents, or a compose file plus
  its `docker-compose.override.yml` (merged the way Compose merges). A drop that mixes formats imports the
  largest group and lists the rest as "not read".
- **Where it lands.** A new entry in Your diagrams, never a replacement, like every Open. Its title comes from the
  compose `name`, AsyncAPI `info.title` (or "N services" when joined), the namespace(s), or the file name.

### UX, in the app's words

No new top-bar control or menu level. The changes:

- **Open…** (Ctrl+O) accepts `.yaml`, `.yml` and Terraform JSON alongside today's formats, several files at a
  time.
- **Drop anywhere** works the same. The drop overlay reads: "Drop to open: Live Diagrams files, draw.io, Mermaid,
  docker-compose, Kubernetes, AsyncAPI or a Terraform plan."
- **Import from ▸ Paste text…** auto-detects these too. Its placeholder lists them.
- **The start card** gets one line under the examples: "Have a docker-compose, Kubernetes or AsyncAPI file? Drop
  it here." This teaches in place, and it's the only new text on screen.
- **The toast** after an import: _Imported “shop” from docker-compose: 11 nodes, 14 connections. 2 guesses._
  **Details**. It shows for 7 s when there's something to check. **Details** opens the report.
- **The Import report** dialog, one primary action (**Done**):

  ```
  Import report · docker-compose.yml                                   ✕
  Drew 11 nodes, 14 connections and 2 boundaries.

  Check these guesses (2)
    storefront      Service   [Node.js Service] [Web Browser] [Other…]
    legacy-adapter  Service   [External API] [Other…]

  Connections found in settings (6)
    orders-api → postgres        SPRING_DATASOURCE_URL
    orders-api → redis           REDIS_URL
    payments-worker → orders.placed.v1 (reads)   INPUT_TOPIC
    …

  Not drawn (3)
    kafka-ui         only in profile "debug"
    pgdata           volume
    zookeeper        part of Kafka

  Couldn't read (1)
    env_file ./.env  not among the files you opened

  Read on this device. Nothing was uploaded.                    [Done]
  ```

  - A stencil chip swaps the stencil as one undo step (`swapStencil`, which the AI panel already uses), and the
    row shows the new one.
  - A row's name selects that node on the canvas.
  - The report stays available from Ctrl+K ("Import report") until you switch diagrams. It's kept in memory, not
    in the file.

- **Errors** say how to fix them:
  - "This looks like a Helm template (`{{ .Values… }}`). Run `helm template` and import its output."
  - "This file has too many aliases (it could expand to millions of values), so it wasn't read."
  - "`terraform plan` files are binary. Run `terraform show -json plan.out > plan.json` and import that."
- **Big imports.** Over **300** nodes to draw, the import asks first, as a multi-page draw.io file does: "This
  would draw 1,240 nodes. Pick what to import:" with checkboxes by namespace, Terraform module or AsyncAPI
  server, and the counts beside them.
- **Private.** An import follows **New diagrams are private**, as opening any file from this device does. The
  report's foot adds "This diagram isn't private. **Make it private**" when it isn't, since infrastructure files
  are often work.

### Stencils: one resolver for every source

`resolveStencil(hint)` tries, in order, and records which step won:

1. **The image table** (compose and Kubernetes; below). High confidence.
2. **The resource-type table** (Kubernetes kinds, Terraform types, AsyncAPI protocols). High confidence.
3. **Environment hints** for language: `SPRING_*` or `JAVA_OPTS` gives Java; `ASPNETCORE_*` or `DOTNET_*` gives
   .NET; `NODE_ENV` gives Node.js; `DJANGO_*`, `FLASK_*` or `UVICORN_*` gives Python. Medium confidence ("a
   guess").
4. **`resolveKind(name, label)`** (`src/ai/stencils.ts`), which already ranks the catalogue, falls back to the
   label keywords in `infer.ts`, and returns alternatives. Medium confidence.
5. **Service** (`generic.service`), low confidence, with the alternatives as chips in the report. The subtitle
   keeps the evidence ("legacy-adapter:1.4", "ServiceMonitor"), so an unknown is never anonymous on the canvas.

**Image table** (repository, any registry, tag ignored):

| Images                                                                                                                            | Stencil                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `postgres`, `postgis/postgis`, `bitnami/postgresql`, `timescale/timescaledb`                                                      | PostgreSQL                                                                  |
| `mysql`, `mariadb`, `bitnami/mysql`                                                                                               | Database (**gap**: add a MySQL stencil)                                     |
| `mcr.microsoft.com/mssql/server`, `azure-sql-edge`                                                                                | SQL Server                                                                  |
| `mongo`, `bitnami/mongodb`                                                                                                        | MongoDB                                                                     |
| `redis`, `bitnami/redis`, `redis/redis-stack`, `valkey/valkey`                                                                    | Redis Cache                                                                 |
| `memcached`                                                                                                                       | Cache                                                                       |
| `cassandra`, `scylladb/scylla` · `clickhouse/clickhouse-server` · `elasticsearch`, `opensearchproject/opensearch` · `minio/minio` | Cassandra · ClickHouse · Elasticsearch · MinIO                              |
| `mcr.microsoft.com/azure-storage/azurite`                                                                                         | Blob Storage                                                                |
| `apache/kafka`, `bitnami/kafka`, `confluentinc/cp-kafka`, `confluentinc/cp-server`, `redpandadata/redpanda`                       | Kafka Cluster                                                               |
| `confluentinc/cp-schema-registry`, `apicurio/apicurio-registry`                                                                   | Schema Registry                                                             |
| `confluentinc/cp-kafka-connect` · `debezium/connect` · `confluentinc/ksqldb-server`                                               | Kafka Connect · Debezium CDC · ksqlDB                                       |
| `zookeeper`, `confluentinc/cp-zookeeper`                                                                                          | not drawn ("part of Kafka")                                                 |
| `rabbitmq` · `nats` · `apachepulsar/pulsar`                                                                                       | RabbitMQ Queue · NATS Subject · Pulsar Topic                                |
| `mcr.microsoft.com/azure-messaging/servicebus-emulator`                                                                           | Service Bus Queue                                                           |
| `eclipse-mosquitto`, `emqx/emqx`                                                                                                  | Topic (**gap**: an MQTT broker stencil)                                     |
| `nginx` · `traefik` · `haproxy` · `envoyproxy/envoy` · `kong` · `caddy`                                                           | NGINX · Traefik · HAProxy · Envoy · Kong · Load Balancer                    |
| `prom/prometheus` · `grafana/grafana` · `grafana/loki` · `jaegertracing/*` · `otel/opentelemetry-collector*`                      | Prometheus · Grafana · Loki · Jaeger · OpenTelemetry Collector              |
| `hashicorp/vault` · `quay.io/keycloak/keycloak` · `temporalio/*` · `apache/airflow` · `flink`                                     | Vault · Keycloak · Temporal · Airflow · Flink                               |
| `mailhog/mailhog`, `axllent/mailpit`                                                                                              | Email                                                                       |
| `provectuslabs/kafka-ui`, `tchiotludo/akhq`, `obsidiandynamics/kafdrop`, `dpage/pgadmin4`, `adminer`                              | not drawn ("developer tool"), listed                                        |
| `localstack/localstack`                                                                                                           | not drawn, listed: "emulates AWS; its services aren't known from the image" |

### Connections from settings (compose and Kubernetes)

This is the gap no other tool fills. A connection is inferred when a variable's value names another component.
**Values are read in memory only to find host names. They're never stored:** no value, password or connection
string reaches the diagram, the report or the clipboard.

| Variable (name or value)                                                                                                                                                                                                                                                                                        | Finds                    | Draws                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A URL value: `postgres(ql)://`, `jdbc:postgresql://`, `mysql://`, `mongodb(+srv)://`, `redis(s)://`, `sqlserver://`, `http(s)://`, `grpc://`, `amqp(s)://`, `nats://`                                                                                                                                           | The host                 | A **Request** to a store, cache or service. A broker gets **Depends on** until direction is known (below)                                          |
| A name ending `_HOST`, `_HOSTNAME`, `_SERVER`, `_ADDR`, `_ENDPOINT`, `_URL`, `_URI`, `_DSN`, with a `host[:port]` value                                                                                                                                                                                         | The host                 | Same                                                                                                                                               |
| `KAFKA_BOOTSTRAP_SERVERS`, `*_BROKERS`, `SPRING_KAFKA_BOOTSTRAP_SERVERS`, `bootstrap.servers` (comma-separated `host:port`)                                                                                                                                                                                     | The Kafka cluster        | **Depends on** the cluster, unless topics are known                                                                                                |
| `*_TOPIC(S)` with `INPUT`, `IN`, `SOURCE`, `CONSUME`, `SUBSCRIBE` or `LISTEN` in the name                                                                                                                                                                                                                       | Topic(s), read           | Topic node(s) in the cluster's boundary, and a **Message** topic → service, with `props.group` from `CONSUMER_GROUP` / `*_GROUP_ID`                |
| `*_TOPIC(S)` with `OUTPUT`, `OUT`, `SINK`, `TARGET`, `PUBLISH`, `PRODUCE` or `EVENTS`                                                                                                                                                                                                                           | Topic(s), written        | A **Message** service → topic                                                                                                                      |
| Any other `*_TOPIC`                                                                                                                                                                                                                                                                                             | Topic, direction unknown | A **Message** service → topic, marked as a guess in the report                                                                                     |
| `SCHEMA_REGISTRY_URL`                                                                                                                                                                                                                                                                                           | The registry             | **Depends on** (the stencil's inferred relation)                                                                                                   |
| `*_FILE=/run/secrets/<name>`                                                                                                                                                                                                                                                                                    | A Compose secret         | **Secret** dependency                                                                                                                              |
| A known cloud host: `*.servicebus.windows.net`, `*.vault.azure.net`, `*.azconfig.io`, `*.documents.azure.com`, `*.database.windows.net`, `*.rds.amazonaws.com`, `*.cache.amazonaws.com`, `sqs.*.amazonaws.com`, `api.stripe.com`, `api.sendgrid.com`, `api.openai.com`, `api.anthropic.com`, `hooks.slack.com`… | That product             | A node with the product's stencil, and its inferred relation: Key Vault gives **Secret**, App Configuration gives **Config**, the rest **Request** |
| Any other external `https://host`                                                                                                                                                                                                                                                                               | An outside API           | **External API** labelled with the host, and a **Request**                                                                                         |

- **Host matching.**
  - Compose: service names, `container_name`, `hostname` and network aliases.
  - Kubernetes: `svc`, `svc.ns`, `svc.ns.svc` and `svc.ns.svc.cluster.local`, StatefulSet pod names
    (`postgres-0.postgres`), and Services resolved to their workloads through selectors.
  - Ignored: `localhost`, `127.0.0.1`, `0.0.0.0` and bare IPs.
- **Safety.**
  - Values longer than 2,048 characters are skipped.
  - Every pattern is linear, with no nested quantifiers. A ReDoS test feeds each one 100 kB of adversarial input.
  - URL userinfo (`user:pass@`) is cut before anything else looks at the value.
  - Setting _names_ go through `sanitizeSettings`, which already rejects credential-shaped text.
- **Evidence.** Every inferred link carries the variable name for the report ("SPRING_DATASOURCE_URL"). A flow
  found this way wins over `depends_on` for the same pair, so there are never two edges where one would do.

### Mapping: docker-compose

| Compose                                                                                            | Diagram                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `services.<name>`                                                                                  | A node, labelled with the name. Stencil from `resolveStencil`. Subtitle: the image and tag, or "built from ./services/orders-api" |
| `deploy.replicas` (or `scale`)                                                                     | `props.replicas`                                                                                                                  |
| `environment` (map or `KEY=VAL` list), `${VAR:-default}`                                           | The connection rules above. Interpolation uses the file's own defaults only; `${VAR}` without one stays opaque                    |
| `depends_on` (short and long, any `condition`), `links`, `network_mode: service:x`, `volumes_from` | **Depends on**, unless a flow already joins the pair                                                                              |
| `secrets` on a service                                                                             | **Secret** dependency to one "Compose secrets" node (Secret Store)                                                                |
| `configs` on a service                                                                             | **Config** dependency to one "Compose configs" node (Config Store), with the config names as its **settings**                     |
| `ports` publishing 80 or 443, or any port on a gateway stencil                                     | One **Users** node (User) with a **Request** to each such service. That gives the simulation an entry point                       |
| `networks`                                                                                         | Boundaries (see Layout)                                                                                                           |
| `profiles`                                                                                         | Services outside the default profile aren't drawn; they're listed                                                                 |
| `x-*`, anchors and `<<` merge keys                                                                 | Resolved before mapping (merge keys on)                                                                                           |
| `extends` in the same file                                                                         | Resolved. From another file: listed, unless that file was opened too                                                              |
| `include`, `env_file`                                                                              | Listed as "couldn't read", unless opened together                                                                                 |
| `volumes`, `healthcheck`, `logging`, `restart`, `command`, `build` details                         | Not drawn (no report line: they aren't components)                                                                                |

A reverse proxy's `depends_on` names its upstreams, so from a gateway stencil it gives a **Request**, not Depends
on. That makes gateway → storefront and gateway → orders-api real paths in Live.

The fixture (`compose/docker-compose.yml`, 11 services) should give 10 service nodes, plus Users, Compose
secrets, two topics and one External API:

- **Not drawn:** `kafka-ui` (profile "debug"). `zookeeper` would go too, but the file uses KRaft and has none.
- **Topics.** `orders.placed.v1` and `payments.completed.v1`:
  - payments-worker reads one (`INPUT_TOPIC`, group `payments`) and writes the other (`OUTPUT_TOPIC`).
  - orders-api writes `orders.placed.v1` (`ORDERS_TOPIC`, a guess).
  - shipping-worker names brokers but no topic, so it gets **Depends on** Kafka.
- **Connections from settings:**
  - storefront → orders-api (`ORDERS_API_URL`)
  - orders-api → postgres and redis (`SPRING_DATASOURCE_URL`, `REDIS_URL`)
  - shipping-worker → postgres (`DATABASE_URL`, whose password is never read)
  - orders-api and payments-worker → Schema Registry (`SCHEMA_REGISTRY_URL`)
  - payments-worker → External API `api.payments.example.com`
- **Not inferred:** legacy-adapter's `UPSTREAM=tcp://…` matches no rule (neither the name nor the scheme), so
  nothing is drawn for it. Unmatched variables aren't listed: they'd be noise.
- **Guesses:** storefront (an unknown image; Node.js from `NODE_ENV`) and legacy-adapter (Service).

### Mapping: Kubernetes

| Kubernetes                                                                                                                         | Diagram                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything with a pod template (`spec.template.spec.containers`): Deployment, StatefulSet, DaemonSet, Argo Rollout, Knative Service… | A node. Stencil from the main container's image, else Kubernetes Deployment. `spec.replicas` gives `props.replicas`. Matching on the pod template rather than the kind means CRDs that wrap pods work without a table entry                  |
| CronJob, Job                                                                                                                       | Scheduler (a source, so it emits in Live), subtitle the schedule                                                                                                                                                                             |
| Pods and ReplicaSets with `ownerReferences` (from `kubectl get all -o yaml`)                                                       | Folded into their owner                                                                                                                                                                                                                      |
| Service                                                                                                                            | Not a node: requests to it go to the workloads its `selector` matches. With no matching workload it's a Service node, "no workload in these files". `type: ExternalName` gives an External API. `type: LoadBalancer` gives a **Users** entry |
| Ingress (`ingressClassName`: nginx, traefik, haproxy, kong, istio, `alb`, `gce`, `azure-application-gateway`)                      | A gateway node of that product (else Load Balancer). A **Request** to each backend's workload. **Users** → Ingress                                                                                                                           |
| ConfigMap, via `envFrom.configMapRef`, `configMapKeyRef` or a volume                                                               | A ConfigMap node and a **Config** dependency. Its data **keys** (never values) become the edge's settings: "4 settings"                                                                                                                      |
| Secret, via `envFrom.secretRef`, `secretKeyRef` or a volume                                                                        | A Kubernetes Secret node and a **Secret** dependency. `data` is never decoded. A referenced Secret not in the files is still drawn, "not in these files". TLS and image-pull secrets aren't drawn                                            |
| ServiceAccount with `azure.workload.identity/client-id`, `eks.amazonaws.com/role-arn` or `iam.gke.io/gcp-service-account`          | Managed Identity, IAM Role or Identity Provider, and an **Identity** dependency from each workload using it                                                                                                                                  |
| Namespace                                                                                                                          | A boundary (tone Kubernetes)                                                                                                                                                                                                                 |
| KEDA `ScaledObject` (`kafka`, `azure-servicebus`, `aws-sqs-queue`, `rabbitmq` triggers)                                            | The trigger's topic or queue becomes a node, with a **Message** from it to `scaleTargetRef`, and `props.group` = `consumerGroup`. The replica range goes in the report. CPU, cron and other triggers are listed only                         |
| HorizontalPodAutoscaler                                                                                                            | Replica range in the report                                                                                                                                                                                                                  |
| Strimzi `Kafka`, `KafkaTopic` (`kafka.strimzi.io/v1beta2` and `v1`)                                                                | The cluster is shown through its topics, in its namespace's boundary. A KafkaTopic is a Kafka Topic node labelled `spec.topicName`, with `props.partitions`                                                                                  |
| Strimzi `KafkaUser` with `simple` ACLs (if cheap)                                                                                  | Write on a topic gives a producer flow; Read plus a group gives a consumer flow. The user's Secret, mounted by a workload, says which workload it is                                                                                         |
| PVC, NetworkPolicy, PDB, RBAC, LimitRange, ResourceQuota, PriorityClass, cert-manager, ServiceMonitor, any other CRD               | Not drawn. Listed, grouped by kind with counts ("1 ServiceMonitor (monitoring.coreos.com)")                                                                                                                                                  |
| `kind: List` with `items`                                                                                                          | Its items                                                                                                                                                                                                                                    |

The fixture set (`k8s/`, 5 files) should give two boundaries (`shop`, `kafka`). Expected content:

- **Inside:** orders-api (3 replicas), payments-worker, the settlement-report scheduler, PostgreSQL, Redis, the
  storefront Service node, NGINX ingress plus Users, two topics, ConfigMap, two Secrets and Managed Identity.
- **Flows:** orders.placed.v1 → payments-worker (from KEDA, group `payments`), and payments-worker →
  payments.completed.v1 (`OUTPUT_TOPIC`).
- **Requests:** orders-api → postgres (`DATABASE_HOST`) and orders-api → redis (`REDIS_URL` in its ConfigMap:
  ConfigMap values are read like inline ones; Secret values never are). settlement-report → postgres too.
- **Guessed flow:** orders-api → orders.placed.v1 (`ORDERS_TOPIC`, direction a guess).
- **Listed:** one ServiceMonitor.

### Mapping: AsyncAPI 2.x and 3.x

AsyncAPI describes **one application per document**. Operations are from its point of view. In 3.x, `send`
means it sends. 2.x inverts the words: `publish` means others publish _to_ it, so it **receives**, and
`subscribe` means it **sends** ([2.6 spec][asyncapi-26]). The 2.6 fixture checks this. 3.x moved operations to the
top level, gave channels an `address`, and made `operation.messages` `$ref`s into the channel's messages
([migration][asyncapi-v3]). 3.1 (2026) only adds a ROS 2 binding ([notes][asyncapi-31]).

| AsyncAPI                                                                | Diagram                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The document (`info.title`)                                             | One service node: the application. `x-` and tags are ignored for the stencil; it's a Service unless `resolveKind(title)` is sure                                                                                         |
| `servers.<id>` (`protocol`, `host` or 2.x `url`)                        | A boundary per server ("Kafka · kafka-0.shop.internal:9092"), holding the channels that use it. Servers with the same host and protocol family are one, across files. Tone from the host (Azure, AWS, GCP), else neutral |
| Channel (3.x `address`, or the key; 2.x the key)                        | A broker node labelled with the address. Stencil from protocol and binding (next table). `{params}` in the address stay in the label                                                                                     |
| Kafka channel binding `partitions`                                      | `props.partitions`                                                                                                                                                                                                       |
| `send` (3.x) / `subscribe` (2.x)                                        | A **Message** app → channel. With exactly one message, the edge's `props.emits` is its name. If the address says dead letter (`dlq`, `dead-letter`, `.dlt`), it's the app's DLQ route (`props.dlq: true`)                |
| `receive` (3.x) / `publish` (2.x)                                       | A **Message** channel → app. `props.filter` lists the operation's messages (or the channel's). `props.group` comes from the Kafka operation binding's `groupId` (`const` or the single `enum` value)                     |
| `operation.reply` (3.x)                                                 | The reply channel and a flow back                                                                                                                                                                                        |
| Message `contentType` or payload `schemaFormat` naming Avro or Protobuf | The channel's `props.contentType`, read by the `schema-registry` check (`architecture-checks.md`)                                                                                                                        |
| Kafka server binding `schemaRegistryUrl`                                | A Schema Registry node, with **Depends on** from every app using that server's channels                                                                                                                                  |
| SNS operation binding `consumers[]` (sqs, lambda, http)                 | SNS → each consumer, as flows                                                                                                                                                                                            |
| SQS channel binding `deadLetterQueue`                                   | A DLQ queue and a DLQ route (`props.dlq: true`)                                                                                                                                                                          |
| AMQP channel binding `is: queue` / `exchange.type`                      | RabbitMQ Queue / RabbitMQ Exchange                                                                                                                                                                                       |
| Security schemes, payload schemas, tags, external docs, traits          | Not drawn; counted in the report                                                                                                                                                                                         |
| Several documents                                                       | **Joined**: channels with the same protocol family and address are one node; apps with the same title are one node. A producer in one file and a consumer in another become one flow                                     |

**Protocol → stencil:**

| Protocol                                                     | Stencil                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `kafka`, `kafka-secure`                                      | Kafka Topic. A host on `*.confluent.cloud` gives Confluent Cloud; `*.kafka.*.amazonaws.com` gives Amazon MSK                                  |
| `amqp`, `amqps`, `amqp1`                                     | RabbitMQ Exchange (`routingKey`, the default) or Queue (`is: queue`). A host on `*.servicebus.windows.net` gives a Service Bus Topic or Queue |
| `sns` · `sqs` · `googlepubsub` · `pulsar` · `nats` · `redis` | Amazon SNS · Amazon SQS · Pub/Sub · Pulsar Topic · NATS Subject · Redis Stream                                                                |
| `mqtt`, `secure-mqtt`, `mqtt5`                               | Topic (**gap**: an MQTT broker stencil), plus a report line                                                                                   |
| `solace`, `ibmmq`, `jms`, `anypointmq`, `stomp(s)`           | Topic or Queue (from the binding), plus a report line                                                                                         |
| `http(s)`, `ws(s)`, `mercure`                                | Topic labelled with the path, plus a report line ("HTTP and WebSocket channels are drawn as topics")                                          |
| none (no servers)                                            | From the binding keys on the channel (a `kafka` binding gives Kafka), else Topic                                                              |

**Ready to Go live.** An app that only sends would be a processor with no input, so it would emit nothing in
Live. The import therefore adds one saved simulation, **Imported traffic**: a constant 1 msg/s at each app that
only sends, with its first message's type. The first **Go live** shows typed, coloured messages flowing.

**`$ref`.** Only local refs (`#/…`) are followed, with cycle detection and at most 32 levels. Remote refs
(`https://…`, `./other.yaml`) are never fetched. They're listed under "Couldn't read", unless the referenced file
was opened in the same import. See `hostile/recursive-ref.asyncapi.yaml`.

The fixtures, imported together (`orders-service`, `shipping-service`, `notifications-2.6`), should give three
apps:

- **Boundaries:** two, Kafka and RabbitMQ. The files name the same hosts.
- **Channels:** six Kafka topics and two RabbitMQ nodes.
  - `order-notifications` is an exchange binding in one file and a queue in the other. The two join as one node:
    the `queue` binding wins, and the report names the exchange (`notifications`).
  - `email.sent` is the second RabbitMQ node.
- **Joined:** Order service → `orders.placed.v1` → Shipping service, and Order service → `order-notifications`
  → Notification service.
- **Avro:** `orders.placed.v1` gets `contentType` Avro. Schema Registry gets Depends on from both Kafka apps.
- **Shipping's DLQ:** the send to `shipping.orders-placed.dlq` becomes its DLQ route (`props.dlq: true`), because
  the address says so.
- **Consumer groups:** `payments.completed.v1` → Order service (`order-service`).

### Mapping: Terraform (`terraform show -json`)

Input is a plan (`planned_values`, `configuration`) or a state (`values`). The importer checks `format_version`
major 1 and rejects others with a message ([format][tf-json]). It reads `values.root_module` and its
`child_modules`. Edges come from two places:

- **Glue resources**, which are message flows in themselves (the rows marked → below).
- **`configuration…expressions.*.references`** between drawn resources. An IAM role or managed identity gives
  **Identity**; Key Vault or Secrets Manager gives **Secret**; Parameter Store or App Configuration gives
  **Config**; anything else gives **Depends on**.

The state's `dependencies` list isn't used: it's transitive and HashiCorp says it can't be read as direct
dependencies ([discuss][tf-deps]).

| Resource types                                                                                                                                                                                                     | Stencil / edge                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `aws_sqs_queue` (`redrive_policy` → DLQ route) · `aws_sns_topic` · `aws_kinesis_stream` · `aws_msk_cluster` · `aws_mq_broker`                                                                                      | Amazon SQS · Amazon SNS · Kinesis · Amazon MSK · Amazon MQ                                                                      |
| → `aws_sns_topic_subscription`                                                                                                                                                                                     | Flow SNS → endpoint (SQS, Lambda, HTTP)                                                                                         |
| → `aws_lambda_event_source_mapping`                                                                                                                                                                                | Flow source (SQS, Kinesis, MSK, DynamoDB stream) → function                                                                     |
| `aws_cloudwatch_event_bus`/`_rule`, → `aws_cloudwatch_event_target`                                                                                                                                                | Amazon EventBridge; flow bus → target                                                                                           |
| `aws_lambda_function` · `aws_ecs_service` · `aws_sfn_state_machine`                                                                                                                                                | AWS Lambda · Amazon ECS · Step Functions                                                                                        |
| `aws_lb`/`aws_alb` (→ listener and target group attachments) · `aws_api_gateway_*`/`aws_apigatewayv2_*` (→ integrations)                                                                                           | Elastic Load Balancing · Amazon API Gateway, with flows to their targets                                                        |
| `aws_db_instance`, `aws_rds_cluster` (by `engine`) · `aws_dynamodb_table` · `aws_s3_bucket` (→ `aws_s3_bucket_notification`) · `aws_elasticache_*`                                                                 | PostgreSQL / Aurora / Database · DynamoDB · S3 · Redis Cache                                                                    |
| `aws_secretsmanager_secret` · `aws_ssm_parameter` · `aws_iam_role` · `aws_cloudfront_distribution` · `aws_wafv2_web_acl`                                                                                           | Secrets Manager · Parameter Store · IAM Role · CDN · Firewall / WAF                                                             |
| `azurerm_servicebus_queue`/`_topic`, → `_subscription` (`forward_to`)                                                                                                                                              | Service Bus Queue / Topic, with flows                                                                                           |
| `azurerm_eventhub` · `azurerm_eventgrid_topic`/`_system_topic` (→ `_event_subscription`) · `azurerm_storage_queue`                                                                                                 | Event Hubs · Event Grid · Storage Queue                                                                                         |
| `azurerm_linux_function_app`/`windows_` · `_web_app` · `azurerm_container_app` · `azurerm_kubernetes_cluster`                                                                                                      | Azure Functions · App Service · Container Apps · AKS                                                                            |
| `azurerm_mssql_database` · `azurerm_postgresql_flexible_server` · `azurerm_cosmosdb_account` · `azurerm_redis_cache`/`azurerm_managed_redis` · `azurerm_storage_account`                                           | Azure SQL · PostgreSQL · Cosmos DB · Azure Managed Redis · Blob Storage                                                         |
| `azurerm_key_vault` · `azurerm_app_configuration` · `azurerm_user_assigned_identity` · `azurerm_api_management` · `azurerm_cdn_frontdoor_profile` · `azurerm_application_gateway` · `azurerm_application_insights` | Key Vault · App Configuration · Managed Identity · API Management · Front Door · Application Gateway · Application Insights     |
| `google_pubsub_topic`, → `google_pubsub_subscription` (`push_config`)                                                                                                                                              | Pub/Sub, with a flow to the push endpoint                                                                                       |
| `google_cloud_run_v2_service` · `google_cloudfunctions2_function` · `google_container_cluster` · `google_dataflow_job`                                                                                             | Cloud Run · Cloud Functions · GKE · Dataflow                                                                                    |
| `google_sql_database_instance` · `google_spanner_instance` · `google_bigquery_dataset` · `google_storage_bucket` · `google_firestore_database` · `google_secret_manager_secret`                                    | Cloud SQL · Cloud Spanner · BigQuery · Cloud Storage · Firestore · Secret Manager                                               |
| `confluent_kafka_topic`, `kafka_topic`                                                                                                                                                                             | Kafka Topic                                                                                                                     |
| Other component-like types (names ending `_function`, `_queue`, `_topic`, `_database`, `_cluster`, `_instance`, `_bucket`, `_service`, `_app`)                                                                     | Service or Database, as a guess, listed                                                                                         |
| Everything else (`_policy`, `_attachment`, `_association`, `random_*`, `null_*`, `time_*`, `tls_*`…)                                                                                                               | Not drawn; counted by type. **Draw everything** in the report re-imports with every resource as a node, like Inframap's `--raw` |

- **Modules** become boundaries (`module.orders`). With no modules, Azure resource groups do. The provider sets
  the tone.
- **`count` / `for_each`.** Instances of one resource are one node, subtitled "×3".
- **Attributes.** Only a whitelist is read (`arn`, `id`, `name`, `topic_arn`, `event_source_arn`, `function_name`,
  `engine`, `endpoint`, `forward_to`, `push_config.push_endpoint`…). `sensitive_values`, and every other attribute,
  are never read. Plans can hold passwords in plain text.

### Layout and boundaries

The layered layout today treats every edge alike, and it doesn't know about boundaries. Imports need both, so the
importer lays out in three steps (shared, `src/interop/infra/layout.ts`):

1. **Inside each boundary.** `layeredLayout` on its members and the **flows** between them, left to right.
2. **Boundaries as blocks.** `layeredLayout` on the blocks and the loose nodes, using the flows between blocks, so
   Users → Ingress → shop → kafka reads left to right. Then `fitGroupToContents`.
3. **Dependency targets beside their users.** A config, secret, identity or registry node with no flows goes
   next to its first user, below the flow lane, using `placeNew`'s "incremental" placement, clear of everything.
   Shared ones (a Key Vault used by five services) go below the block's centre.

**Boundaries**, by source:

| Source     | Boundaries                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes | Namespaces. Workloads, ConfigMaps and Secrets go in their namespace. Managed identities and outside services go outside                                                                                                                                                                                                                      |
| Compose    | Networks, when they divide the services (at least 2 networks, and 80% or more of services on exactly one). A service on several networks goes in the one holding most of its connections, and the report says so ("orders-api is on frontend and backend; shown in backend"). Otherwise none. The `default` network never becomes a boundary |
| AsyncAPI   | One per server: the broker and its channels. Apps stay outside                                                                                                                                                                                                                                                                               |
| Terraform  | Modules, else resource groups                                                                                                                                                                                                                                                                                                                |

- Members never sit in two boundaries; that's the model's rule.
- Nested boundaries (cluster ▸ namespace) aren't used in v1.
- The overlap audit (`tests/e2e/layout.spec.ts`) gets one Lab preset per fixture ("Imported: compose", "Imported:
  Kubernetes", "Imported: AsyncAPI").

### Unknowns, and the report

Three outcomes for everything read, and nothing else:

1. **Drawn as what it is:** high confidence, no report line. Inferred connections are listed with their evidence.
2. **Drawn as a guess:** medium or low confidence, on its best stencil (or Service). Listed under "Check these
   guesses" with chips. The subtitle keeps the evidence.
3. **Not drawn:** listed with a reason, grouped and counted. Reasons are fixed strings: "only in profile …",
   "part of Kafka", "volume", "developer tool", "not a component (PodDisruptionBudget)", "unknown kind
   (monitoring.coreos.com/ServiceMonitor)", "Terraform type not drawn (aws_iam_policy ×14)".

Plus "Couldn't read": remote refs, files not opened, unresolved anchors. The report is a plain list in memory. It
lives as long as the diagram stays open in this tab, and it never goes in the file, a share link or an export.

## Libraries and bundle cost

Measured on 2026-10-12 with esbuild (minified, browser target), `gzip -9`, or the published file for
prebuilt bundles and WebAssembly:

| Library                                                  | Version        | Licence          | Minified                       | Gzip                                                                                       | Notes                                                                                                                                                                                                                | Verdict                                                               |
| -------------------------------------------------------- | -------------- | ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **`yaml`** (`parseAllDocuments`)                         | 2.9.1          | ISC              | 97.3 kB                        | **30.3 kB**                                                                                | `maxAliasCount` (default 100) counts **expansion**: the bomb fixture fails in 2 ms. Merge keys via `merge: true`. Line numbers for messages. Duplicate keys rejected                                                 | **Use**, lazy (one chunk shared by every YAML reader)                 |
| `js-yaml` (`load`, `loadAll`, `CORE_SCHEMA`, `mergeTag`) | 5.4.3          | MIT              | 46.3 kB                        | 13.6 kB                                                                                    | `maxAliases` counts aliases, default unlimited. The bomb (81 aliases) parses, and a naive walk of the result visits 5 million nodes in 126 ms with no end in sight. Merge keys need `CORE_SCHEMA.withTags(mergeTag)` | Fallback if 17 kB matters, with `maxAliases: 50` and a bounded walker |
| `@asyncapi/parser` (browser bundle)                      | 3.6.3          | Apache-2.0       | 2.18 MB                        | 401 kB                                                                                     | Spectral, ajv, avsc. Contains `new Function` (ajv's compiled validators): **blocked by our CSP** (no `unsafe-eval`)                                                                                                  | No: our own reader, about 6 kB                                        |
| `hcl2-parser` (GopherJS)                                 | 1.0.3          | MIT              | 3.80 MB                        | 652 kB                                                                                     | Last published 2021                                                                                                                                                                                                  | No                                                                    |
| `@cdktf/hcl2json` (Go → WebAssembly)                     | 0.21.0         | MPL-2.0          | 6.5 MB wasm                    | 1.68 MB                                                                                    | CDKTF was archived in Dec 2025. Needs `'wasm-unsafe-eval'` in `script-src`                                                                                                                                           | No                                                                    |
| `web-tree-sitter` + `tree-sitter-hcl`                    | 0.27.1 / 1.2.0 | MIT / Apache-2.0 | 210 kB + 92 kB wasm, 156 kB JS | 83 kB + 19 kB + about 20 kB, ≈ **120 kB**                                                  | A syntax tree only; references, modules and `count` would be ours to write. Needs `'wasm-unsafe-eval'`                                                                                                               | Not now                                                               |
| `parse-hcl`                                              | 1.0.2          | Apache-2.0       | 36.1 kB                        | 10.8 kB                                                                                    | Pure TypeScript, 2025, one maintainer. Imports Node's `fs` (must be stubbed). Untested in browsers                                                                                                                   | Candidate if HCL is ever wanted                                       |
| Our readers (estimates)                                  | —              | —                | —                              | core 3–4, compose 3–4, Kubernetes 5–6, AsyncAPI 5–7, Terraform 5–7 (mostly mapping tables) | All lazy                                                                                                                                                                                                             | —                                                                     |

- **Entry chunk.** The sniffers add under 1 kB gzip to the entry (107.5 kB of 123.5 kB).
- **Lazy chunks.** The YAML chunk and each reader load on first use, or when the File menu opens
  (`preloadFormats`), like the draw.io and Mermaid converters.
- **Guarded.** `bundleSplit.build.test.ts` adds `src/interop/infra/` and the `yaml` package to `NOT_AT_STARTUP`.

## Security

Everything here is untrusted input.

- **Size.** The existing 8 MB cap (`LIMITS.maxTextChars`) applies to the total of all files in one import, checked
  by `File.size` before reading. At most 2,000 YAML documents and 100 files per import.
- **YAML bombs and anchors.** The `yaml` options:
  - `maxAliasCount: 100` (counts expansion)
  - `merge: true`
  - the core schema with no custom tags, so `!!js/function` stays a string and warns
  - `uniqueKeys: true`

  `hostile/yaml-bomb.yaml` must fail fast with "too many aliases". The mapped object is then walked iteratively
  with the native validator's depth limit (48) and a 200,000-node budget, so even an object graph that passed the
  parser can't run away.

- **`$ref`.** Local refs only, at most 32 deep, with cycle detection, and at most 10,000 resolutions. Never fetched
  (`hostile/recursive-ref.asyncapi.yaml`).
- **No code execution.** Nothing is evaluated:
  - not Helm or Go templates, Jsonnet or CUE
  - not shell in `command` or `healthcheck`
  - not Terraform expressions
  - not `${…}` beyond a literal default

  No `eval` or `new Function`, which the CSP enforces anyway. No WebAssembly, so no CSP change.

- **No network.** No remote refs, `include` URLs, Git or OCI includes, env files, image registries or provider
  schemas. The CSP's `connect-src` stays as it is; `csp.spec.ts` covers an import run.
- **Prototype pollution.** Both YAML libraries store `__proto__` and `constructor` as own keys (checked). Readers
  read with `Object.hasOwn` and never spread or merge parsed objects into our own. A test imports a file with
  those keys.
- **ReDoS.** Patterns for hosts and URLs are linear. Inputs are cut to 2,048 characters before matching.
- **Output.** Every import goes through `validateDiagram`: label lengths, ids, finite coordinates, the node and
  edge budgets. The importer's own cap is 300 drawn nodes without asking, and 5,000 at most.

## Privacy

- **Parsed in the tab.** Nothing is uploaded, and the report says so ("Read on this device. Nothing was
  uploaded.").
- **Values are never kept.** Environment values, connection strings, Secret `data` and Terraform attributes are
  read in memory only to resolve host names and references, then dropped. What can reach the diagram: names
  (service, topic, key and variable names), image names and tags, host names of outside services, and counts.
  Setting names pass `sanitizeSettings`, which drops credential-shaped text. A unit test imports every fixture
  and asserts that no password, base64 secret or URL userinfo from it appears anywhere in the diagram JSON or the
  report.
- **Private stays private.** With **New diagrams are private** on, the imported diagram is private
  (`openDiagram` already does this for anything from this device). It then gets no share links, cloud saves or AI,
  like any private diagram. The report offers **Make it private** when the setting is off.
- **AI.** Imports never call an AI. A non-private imported diagram is like any other: agents can read it once
  it's open, as today.

## Risks

- **Wrong inferred edges.** A variable can point somewhere unexpected, and `*_TOPIC` direction is a guess.
  Mitigations: each inferred edge lists its evidence; guesses are marked; brokers get **Depends on**, not a flow,
  when direction is unknown; Undo.
- **Noisy diagrams from big inputs** (a whole cluster dump, a large state). Mitigations: whitelists, folding
  (Pods into owners, Services into workloads, instances into one node), and the 300-node picker.
- **Layout quality at 50 to 300 nodes.** Two-level layout and dependency placement are new. Mitigations: the
  overlap audit on every fixture, and Tidy up afterwards.
- **Mapping tables drift.** New images, new Terraform types and catalogue changes. Mitigations: tables are data
  with tests. Unknowns degrade to a guess plus a report line, never an error.
- **Spec ambiguity.** AsyncAPI 2.x's inverted verbs, documents that describe a broker rather than an app, and
  `x-` conventions. Mitigations: the 2.6 fixture, and an open question on system-level documents.
- **Bundle creep.** Mitigations: the lazy-chunk test, and `pnpm size` in CI.
- **Catalogue gaps** show up as guesses: MySQL/MariaDB, an MQTT broker, a GCP service account. Add the stencils
  in the batch that first needs them (icons under the licences in `docs/ICONS.md`).

## Build batches

Each batch is its own PR and ends with the UX review gate (`docs/UX-PRINCIPLES.md` § Process; findings in
`docs/DESIGN-REVIEW.md`).

1. **Import core and docker-compose.** Covers:
   - sniffing, multi-file Open… and drop, the lazy `yaml` chunk
   - `ImportGraph`, `resolveStencil` with the image table, and the settings-connection resolver
   - the three-step layout, the Import report dialog with stencil chips, and the toast
   - the hostile fixtures and the no-values-leak test
   - the start-card line and the drop-overlay copy
   - a MySQL stencil

   _UX gate: the report's density and wording, the toast, dark theme, 1280×800, the overlap audit on the compose
   fixture._

2. **AsyncAPI 2.x and 3.x.** Covers:
   - the reader and the local `$ref` resolver
   - joining several documents
   - protocol and binding mapping
   - `emits`, `filter` and `group`, and the Avro `contentType`
   - the Schema Registry from server bindings, and the **Imported traffic** simulation

   _Gate: the three fixtures imported together Go live with typed messages and no overlaps._

3. **Kubernetes manifests.** Covers:
   - workloads by pod template, selectors, Ingress, ConfigMaps with key settings, Secrets
   - workload identity, namespaces, `kind: List` and owner folding
   - KEDA triggers, and Strimzi topics (`v1beta2` and `v1`)
   - the 300-node picker
   - KafkaUser ACLs only if they fit in the batch

   _Gate: the fixture set, plus a `kubectl get all -o yaml`-style dump._

4. **Terraform plan and state JSON.** Covers the type table (AWS, Azure, GCP, Confluent), glue resources as
   flows, references as dependencies, modules as boundaries, **Draw everything**, and the attribute whitelist with
   a no-secrets test. Adds a self-written plan JSON fixture. _Gate: a 200-resource plan reads as a system, not a
   resource dump._
5. **Later, only if asked:**
   - Terraform HCL (`parse-hcl` or our own block scanner, best effort, labelled as such)
   - joining Kubernetes and AsyncAPI by app name
   - Compose `include` across files

## Explicitly not doing

- **Live scans** of clusters or cloud accounts (Cloudcraft, Hava, KubeView). They need credentials and a backend.
- **Rendering templates or building configs**: Helm charts, Kustomize overlays, Jsonnet, CUE, Terragrunt. That's
  code execution; import their output instead.
- **Fetching anything**: remote `$ref`s, includes, env files, Git, OCI, image metadata.
- **Exporting back** to Compose, Kubernetes, AsyncAPI or Terraform (generating infrastructure from a diagram).
- **Re-importing into an existing diagram** (merge or drift). An import always makes a new diagram, as Open does.
- **Full spec validation** (Spectral rulesets, Kubernetes schemas). We read leniently and report what we skipped.
- **Resource-level graphs**: Pods, ReplicaSets, RBAC, NetworkPolicy reachability, security groups.
- **`terraform graph` DOT, CloudFormation, Bicep, Pulumi, OpenAPI.** Possible later; not asked for.
- **An agent tool for imports.** Agents can already build diagrams with `edit_diagram`, and a file import is a
  person's action.

## Open questions (with recommended defaults)

1. **Which YAML library?** _Default: `yaml`_ (30 kB gzip, lazy). Its expansion-aware alias guard and line numbers
   are worth 17 kB over js-yaml in a chunk that only loads on import.
2. **Should an AsyncAPI import add the "Imported traffic" simulation?** _Default: yes_ (1 msg/s per sending app).
   Without it, the first Go live shows nothing moving, and moving messages are the point of the app.
3. **When a service talks to Kafka but no topic is named, what do we draw?** _Default: **Depends on** the Kafka
   cluster_, listed as "couldn't tell what it reads or writes". A guessed producer flow would put fake messages
   in Live.
4. **How should an AsyncAPI document that describes a broker or a whole system (not one app) be read?** It might
   say so with an `x-` owner per operation. _Default: read it as one app per the spec, and list operations with
   an `x-eventcatalog-role` or `x-service` extension as a follow-up._ Don't invent a convention before someone
   brings such a file.
5. **Terraform HCL?** _Default: not now._ The import hint says "Run `terraform show -json`". Revisit with
   `parse-hcl` (10.8 kB) if people ask, never with a WebAssembly parser.
6. **Should infrastructure imports be private regardless of the setting?** _Default: no_, follow **New diagrams
   are private**. The report offers **Make it private** one click away, so the choice stays the person's.

[studio-nodes]: https://raw.githubusercontent.com/asyncapi/studio/master/apps/studio/src/components/Visualiser/utils/node-factory.ts "AsyncAPI Studio visualiser node factory"
[eventcatalog]: https://www.eventcatalog.dev/docs/plugins/asyncapi/features "EventCatalog AsyncAPI generator"
[sz-authoring]: https://docs.structurizr.com/usage/authoring "Structurizr: authoring, reverse-engineering needs code"
[icepanel-import]: https://docs.icepanel.io/core-features/model-imports "IcePanel model imports"
[kubediagrams]: https://github.com/philippemerle/KubeDiagrams "KubeDiagrams"
[dcv]: https://github.com/pmsipilot/docker-compose-viz "docker-compose-viz"
[compose-viz]: https://docs.docker.com/reference/cli/docker/compose/alpha/viz "docker compose alpha viz"
[kompose]: https://kompose.io/conversion/ "kompose conversion matrix"
[tf-graph]: https://developer.hashicorp.com/terraform/cli/commands/graph "terraform graph"
[inframap-aws]: https://raw.githubusercontent.com/cycloidio/inframap/master/provider/aws/aws.go "Inframap AWS provider: node and edge types"
[terravision]: https://github.com/patrickchugh/terravision "Terravision"
[pluralith]: https://github.com/Pluralith "Pluralith"
[brainboard]: https://brainboard.feedbear.com/updates/import-terraform-v02 "Brainboard: import Terraform"
[cloudcraft]: https://docs.datadoghq.com/cloudcraft/getting-started/crafting-better-diagrams "Cloudcraft live scan"
[hava]: https://docs.hava.io/using-hava/providers-and-sources "Hava sources"
[drawio-insert]: https://www.drawio.com/docs/manual/editor/menus/arrange-insert-menu/ "draw.io Arrange > Insert"
[composegraph]: https://pkg.go.dev/github.com/zkrebbekx/composegraph@v0.1.2 "composegraph"
[asyncapi-26]: https://raw.githubusercontent.com/asyncapi/spec/v2.6.0/spec/asyncapi.md "AsyncAPI 2.6.0: publish and subscribe meaning"
[asyncapi-v3]: https://www.asyncapi.com/docs/migration/migrating-to-v3 "Migrating to AsyncAPI v3"
[asyncapi-31]: https://www.asyncapi.com/blog/release-notes-3.1.0 "AsyncAPI 3.1.0 release notes"
[tf-json]: https://developer.hashicorp.com/terraform/internals/json-format "Terraform JSON output format"
[tf-deps]: https://discuss.hashicorp.com/t/explanation-of-depends-on-field-under-prior-state-in-terraform-plan-output/75329 "HashiCorp discuss: state dependencies"
