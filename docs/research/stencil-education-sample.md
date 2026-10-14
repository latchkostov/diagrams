# Stencil education: ten finished sample entries

Editorial samples for [`planning-model.md`](planning-model.md), checked 2026-10-14. These are proposed content,
not shipped UI. Each entry has a 2–3 sentence introduction, key concepts, connection guidance, watch-for advice
and **one curated external overview link**. The linked publisher documentation supports the product facts;
additional configuration evidence and version qualifications live in the planning document's source register.
All “In this diagram” numbers below are **hypothetical configured workloads**, not vendor benchmarks or measured
results. Contextual paragraphs must be generated from the real diagram, not stored as static stencil copy.

The same introduction appears in the hover excerpt; the inspector's About section and library preview show the
full entry. Implementation uses translated content keys, lazy family loading and accessible inspector access;
hover is never the only way to read it. No sample implies that unsupported simulation behaviour already works.

## 1. F5 BIG-IP (`f5.bigip`)

**What it is.** BIG-IP Local Traffic Manager sits in front of your applications and distributes traffic among
servers. Clients connect to a virtual server, which selects a member of a configured pool. A monitor helps the
load balancer decide which members can receive traffic.

**Key concepts.** A **virtual server** is the client-facing address and traffic configuration. A **pool** is the
set of possible destinations; a **pool member** is one server address and service port. A **health monitor** checks
whether a destination is usable. **iRules** are event-driven traffic customisations; this simulator doesn't execute
them.

**How it connects.** Draw Request connections from clients or an upstream gateway into BIG-IP, then to services
representing its pool. Replicas belong to those services; BIG-IP routes their work and does not create their capacity.

**What to watch for.** A working load balancer cannot rescue an undersized pool. Health detection and an HA pair
protect against different failures; today's model skips known-down targets immediately, so delayed monitor detection
must be labelled unsupported until implemented.

**In this diagram.** “F5 receives 3 req/s and routes to Orders, whose configured capacity is 1 req/s. Orders is the
bottleneck. At a 50% utilisation target, increase Orders from 1 to 6 replicas; sizing up F5 won't increase Orders'
processing capacity.”

**Overview and fact source:** [F5: Local Traffic Management basics](https://techdocs.f5.com/en-us/bigip-14-1-0/big-ip-local-traffic-management-basics-14-1-0.html).
This is a conceptual guide for a historical software version, not a current hardware throughput specification.

## 2. Kafka topic (`kafka.topic`)

**What it is.** A Kafka topic is a named, retained log of events split into partitions. Producers append events;
consumers track how far they have read using offsets. Reading an event does not remove it from the topic.

**Key concepts.** A **partition** is an ordered part of the log. An **offset** identifies a position within a
partition. A **consumer group** shares partition assignments among its readers; another group reads independently.
**Retention** determines how long records remain available, rather than whether a consumer has acknowledged them.

**How it connects.** Draw a Message from a producer into the topic and one from the topic to each consumer/group.
Name the group on the connection. The consumer node supplies replicas and processing capacity; it can also serve
HTTP or publish to another topic.

**What to watch for.** More reader instances than partitions leave some unassigned in an ordinary consumer group.
Slow processing creates group lag. A poison event's retry or skip policy comes from the consumer/client, not a
universal Kafka delivery count or automatic dead-letter queue. Keys and ordered processing aren't simulated here.

**In this diagram.** “orders has 3 partitions and billing has 8 reader instances. At most 3 instances receive
partition assignments; 5 are idle for this input. Increase partitions if more reader instances are needed, or
improve processing on the assigned readers. This is independent of the topic's ingest limit.”

**Overview and fact source:** [Apache Kafka: design and consumer groups](https://kafka.apache.org/42/design/design/).
This entry describes ordinary consumer groups, not share groups.

## 3. Azure Service Bus queue (`azure.service-bus.queue`)

**What it is.** A Service Bus queue holds messages until a receiver can process them. Multiple receivers compete
for the same work, so one delivery goes to one receiver rather than every subscriber. Peek-lock lets a receiver
finish processing before acknowledging the message.

**Key concepts.** A **queue** buffers work. **Competing consumers** share that work. **Peek-lock** temporarily
reserves a message; **Complete** acknowledges it, while **Abandon** makes it available again. A **dead-letter queue**
holds messages that cannot be delivered or processed successfully under the entity's policy.

**How it connects.** Draw producer → queue → worker Messages. Workers can be replicas of one service or separate
services sharing the work. The queue's built-in dead-letter store doesn't require a second stencil; a drawn route
can describe explicit forwarding or inspection.

**What to watch for.** If a worker goes down, unread work can wait in the queue. Lost locks or unsuccessful processing
can lead to another delivery, so handlers should tolerate repeats. Queue capacity, worker slots and delivery policy
are separate controls; a long backlog doesn't automatically mean messages were lost.

**In this diagram.** “The queue receives 12 msg/s but its workers handle 8 msg/s. Waiting work grows by about 4 msg/s.
Add worker capacity or reduce processing time. Changing the delivery limit won't make those workers faster.”

**Overview and fact source:** [Microsoft: Service Bus queues, topics and subscriptions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions).

## 4. Redis cache (`redis.cache`)

**What it is.** Redis can keep frequently requested data in memory so applications can avoid repeated database
reads. In cache-aside, the application checks Redis, reads the database on a miss and stores the result for later.
Cached data can be stale, so expiry and invalidation are part of the design.

**Key concepts.** A **hit** finds the cached value; a **miss** requires another source. **TTL** limits how long a
cached value remains valid. **Invalidation** removes a value after its source changes. A **cache stampede** occurs
when many requests miss the same value and all try to load it.

**How it connects.** Draw Requests from the application to Redis and to its database. In cache-aside the service
decides which calls are necessary; don't imply Redis forwards misses to the database. A cache-through route is a
different, explicit modelling choice.

**What to watch for.** Hit share and measured ops/s drive the estimate; a maximum client count doesn't prove
operation throughput. A cold cache or simultaneous expiry can increase database demand sharply. The first hit-share
model won't predict per-key stampedes or freshness correctness.

**In this diagram.** “At 100 reads/s and an assumed 90% hit share, the database receives about 10 reads/s. A cold-cache
scenario sends about 100 reads/s instead. Compare database capacity before relying on the warm-cache result.”

**Overview and fact source:** [Redis: cache-aside overview](https://redis.io/docs/latest/develop/use-cases/cache-aside/).

## 5. PostgreSQL (`postgres`)

**What it is.** PostgreSQL stores structured data in relational tables and answers SQL queries. Applications
connect through database sessions and can group changes into transactions. Query performance depends on the
workload and data, so a database name alone doesn't establish its request capacity.

**Key concepts.** A **table** stores rows with defined columns. An **index** helps locate rows for suitable queries.
A **transaction** groups changes with all-or-nothing commit semantics. A **connection** is a client session;
a **connection pool** reuses sessions and limits how many callers can use them.

**How it connects.** Draw Requests from services to the database for reads or writes. Put each service's outbound
pool policy on its connection, while the server connection ceiling and measured active-query budget belong to the
database. Draw a separate CDC flow only when modelling change capture explicitly.

**What to watch for.** Connections are not equal-cost query workers. More service replicas can exhaust the shared
connection budget or increase database contention. Caller-side waiting and cascading failures require request/reply
semantics; the simulator doesn't execute SQL or infer index quality.

**In this diagram.** “The measured planning input is 4 query slots at a mean 20 ms: nominally 200 queries/s under
that workload. At 300 queries/s, work waits. Reduce the query cost or increase measured database capacity; adding
application replicas alone doesn't change this limit.”

**Overview and fact source:** [PostgreSQL: tutorial](https://www.postgresql.org/docs/current/tutorial.html).

## 6. AWS Lambda (`aws.lambda`)

**What it is.** Lambda runs application code when invoked without requiring you to manage a server fleet.
Invocations can come from an API request or an event integration such as a queue. AWS manages execution
environments, while you still choose workload configuration and handle failures.

**Key concepts.** An **invocation** is one execution. **Concurrency** counts executions active at the same time.
An **execution environment** runs the code; a **trigger/event source** determines how it is invoked. **Duration**
is work time, while an **execution timeout** stops work that runs too long.

**How it connects.** Draw a Request from an API gateway or a Message delivery from a supported event source. Draw
Requests from the function to databases/APIs and Messages to brokers for published events. The incoming integration
determines redelivery behaviour; the generic Lambda icon doesn't choose one retry policy for all triggers.

**What to watch for.** Use allocated concurrency and duration, not a fixed pod replica count. Account quotas are
shared, and different triggers have different admission/retry behaviour. Cold-start delay and scaling rate need
explicit assumptions; don't promise immediate unlimited scale.

**In this diagram.** “This function has an allocated concurrency of 20 and mean duration 0.5 s, so its nominal
capacity is 40 invocations/s. At 60/s it needs more allocated capacity or shorter work. For a queue trigger, watch
backlog; for a synchronous request, watch rejected invocations.”

**Overview and fact source:** [AWS: what is Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html).

## 7. Stripe API (`stripe`)

**What it is.** Stripe's API is an external dependency with its own admission limits, beyond your application's
control. A call can be limited by overall request rate, a particular endpoint or concurrent in-progress work.
Slow calls can hit concurrency limits even when requests per second look acceptable.

**Key concepts.** A **global quota** is shared across API traffic. An **endpoint quota** limits one API operation
family. **Concurrency** counts calls still running. A **429** response indicates limiting, with a reason header
for quota-related limits; **backoff** slows later attempts instead of immediately repeating them.

**How it connects.** Draw a Request from your service into Stripe, optionally targeting an endpoint. Configure
Stripe's latency/error assumptions and scoped limits on the API/endpoint; caller retries and deadlines belong to
your service's connection. A separate webhook flow represents notifications arriving from Stripe.

**What to watch for.** Adding replicas of your own caller doesn't increase a Stripe account quota. Not every 429
means the same thing, and some are lock timeouts. Retries must respect the reason and the operation's side effects;
the model won't validate a real payment workflow.

**In this diagram.** “Your configured endpoint budget is 25 req/s and Checkout sends 30 req/s. At steady demand,
about 5 req/s exceed that budget before retries. Reduce calls or arrange a higher applicable quota; adding callers
will not remove the endpoint limit.”

**Overview and fact source:** [Stripe: limits and how to handle them](https://docs.stripe.com/rate-limits).
The example's quota matches the cited endpoint default, but effective account exceptions must still be checked.

## 8. Generic external API (`generic.external-api`)

**What it is.** An external API is a service outside the system you operate, called through a request and response.
For HTTP, each request names an operation/resource and the response reports an outcome. You can model the
boundary without knowing the provider's internal architecture.

**Key concepts.** An **endpoint** is a method and path such as `POST /charges`. **Latency** is time spent awaiting
the response; a **status code** describes its HTTP outcome. A **proxy** may sit between caller and server.
HTTP is **stateless** at protocol level; applications can still maintain state through their own mechanisms.

**How it connects.** Draw a Request from a caller into the API. Endpoints are optional records inside the node,
not extra canvas nodes. Use another incoming flow if the provider initiates a callback into your system. These
connection conventions are the proposed Live Diagrams model, not requirements of HTTP.

**What to watch for.** Unknown latency or quota isn't zero latency or unlimited capacity. Record assumptions
until measurements are available. A successful transport response may not prove the business action succeeded;
declare the outcome you are planning rather than treating every HTTP 200 as equivalent.

**In this diagram.** “Partner API has assumed mean latency 100 ms and no verified quota. At 20 req/s, its rate
headroom is unknown. Enter the provider's applicable limit or measured target before accepting a capacity result.”

**Overview and fact source:** [MDN: overview of HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview).
A generic stencil has no product vendor, so MDN is the curated protocol overview.

## 9. Firewall / WAF (`generic.firewall`)

**What it is.** A firewall enforces policy on traffic crossing a boundary. Rules can allow or deny traffic based
on criteria such as source, destination and application. A WAF focuses on web application traffic; one generic
shape doesn't claim to reproduce every product's inspection engine.

**Key concepts.** A **zone** groups network locations for policy. A **rule** matches selected traffic and gives it
an **action**, such as Allow or Deny. **Source/destination criteria** determine where traffic comes from and goes.
**Inspection** applies configured checks beyond simply forwarding it.

**How it connects.** Put the gateway on a flow path when it enforces a network rule; configure Allow/Deny on each
outgoing connection. An attached WAF policy represented as a dependency is configuration, not an extra traffic hop.
Use an NGFW device stencil with a named size preset when modelling appliance throughput.

**What to watch for.** An intentional deny is blocked traffic, not accidental loss or a backend failure. Allowing
a drawn connection doesn't prove the application is secure. This model doesn't execute a rulebase, reproduce
packet inspection or evaluate TLS/security policy correctness.

**In this diagram.** “This outgoing rule denies 10 of 10 routed messages. They are counted as blocked on purpose.
If the connection should be reachable, change this rule to Allow; increasing throughput or adding replicas won't
change its policy.”

**Overview and fact source:** [Palo Alto Networks: security policy rules](https://docs.paloaltonetworks.com/network-security/security-policy/administration/security-rules).
The vendor example explains the concepts; it isn't a default policy for all firewalls.

## 10. Iterable API (proposed `iterable`, generic marketing fallback)

**What it is.** Iterable's API lets an integration interact with an Iterable project through endpoints for
customer and messaging workflows. Limits can apply per project, API key or organization. Several callers may
therefore compete for the same endpoint allowance.

**Key concepts.** A **project** is the context receiving API work. An **endpoint** identifies the operation.
A **quota scope** determines which callers share a limit. A **429** means the applicable limit was exceeded;
**exponential backoff** spaces retries farther apart. API acceptance and eventual campaign delivery are separate
outcomes in the proposed model.

**How it connects.** Draw Requests from services into Iterable, optionally selecting `POST /api/events/track` or
another endpoint. A webhook or data-feed integration can initiate calls in the other direction; represent that
direction explicitly rather than assuming every Iterable integration only receives traffic.

**What to watch for.** Do not guess one numeric RPS default for the whole product. Get the endpoint's limit and
scope from the applicable API Explorer/account; the research didn't verify a numeric default. More integration
workers may increase 429s if they share a project allowance.

**In this diagram.** “Notifications is configured to send 300 calls/s and Analytics 250 calls/s to the same
project-scoped endpoint. With your explicitly entered 500 calls/s budget, demand is 550/s: about 50/s exceed it.
Reduce combined calls or change the applicable budget. **500/s here is an assumption, not an Iterable default.**”

**Overview and fact source:** [Iterable: getting started with the API](https://support.iterable.com/hc/en-us/articles/41044692130196-Getting-Started-with-Iterable-s-API).
No API key is needed to read the entry; the editor never sends real Iterable calls.
