# P5 research: vendor API profiles

Status: research proposal, accessed **2026-10-15**. Docs only; no implementation or account verification.
Based on `origin/master` at `16060ab9`. Read alongside [planning-model](planning-model.md), especially
P3 and external discovery, [ROADMAP](../ROADMAP.md), [UX principles](../UX-PRINCIPLES.md) and
[QUALITY](../QUALITY.md). The roadmap places P5 after the earlier simulation and refactoring work;
this proposal does not move it forward or implement request/reply retries.

## Recommendation and evidence policy

Make a profile a dated, scoped set of admission assumptions that the user can inspect and override.
Start with P3-compatible limits, retain unknown values, and add richer admission semantics in separate
PRs. A vendor name alone is insufficient: product, environment, model, tier, account scope and sometimes
endpoint determine the budget. Picking a different API key often does not buy more capacity.

All source references below are **official vendor documentation, accessed 2026-10-15**; the source
register repeats that date for each link. Numbers are selected examples, not an exhaustive entitlement
table or a promise of achievable throughput. No authenticated dashboards or live APIs were queried.
Where a page delegates to an account console, dynamically rendered explorer, contract or support, the
profile needs user input. “Not verified” does not mean that a vendor has no such restriction.

Use five evidence states per constraint: **published default**, **published lower bound/recommendation**,
**user supplied**, **assumption**, and **unknown**. Keep modelling fidelity separate: exact within declared assumptions,
approximation, or unsupported. Do not turn documentation header examples into default quotas, or copy
the older planning research's numbers without checking them again.

Retry descriptions are integration guidance, not behaviour that P5 should activate. In addition to
each vendor's instructions, our proposed client guidance is bounded retries, jitter where appropriate,
and idempotency/deduplication before retrying side effects. Respect a documented retry header when
present; absence of a header is not permission to retry immediately. Separate temporary throttling,
contract/spend exhaustion, validation failures, business refusals and eventual delivery failures.

## Vendor findings

Unless explicitly listed, a universal concurrent-request cap, token/day quota, burst size, standard
`Retry-After` header and tier-independent numeric rate were **not verified** in the cited sources.
Token limits apply to LLMs; do not add a token budget to payments or messaging without evidence.

### LLM APIs

**OpenAI.** Limits include RPM, RPD, TPM, TPD and modality-specific budgets; scope is organization and
project, with model-family sharing. The current Standard table uses Build/Launch/Grow, not the older
numeric tier names. For Astra/Sol/Terra it lists respectively **5,000/10,000/15,000 RPM** and
**1M/4M/40M TPM**. Preserve the selected model family and service tier. Short-window enforcement and
ramp throttling mean a minute allowance does not guarantee a minute-sized burst. Responses expose
`x-ratelimit-{limit,remaining,reset}-{requests,tokens}` and sometimes project-token headers. Temporary
`429` may include `Retry-After`; spend exhaustion also returns `429` but needs account action. Back off
exponentially with randomness; unsuccessful attempts consume rate budget. [OAI]
Inspect `error.code`: `slow_down` is ramp throttling; `503 server_is_overloaded` is temporary capacity
pressure and may carry `Retry-After`. Do not retry billing exhaustion as overload. [OAI-ERROR]

**Anthropic.** Messages API has independent RPM, input TPM and output TPM per organization/model class,
with workspace sublimits. Start, Build, Scale and Custom tiers differ; Evaluation may be below the
published Start table. Example **Sonnet 4.x Start: 1,000 RPM, 2M ITPM, 400,000 OTPM**. The documented
algorithm is token bucket; sub-minute bursts can throttle and bucket capacity is not established by
the minute allowance alone. Cache reads are excluded from ITPM for most models; writes count. Input
estimates are adjusted and output is metered as produced. `429 rate_limit_error` names the constraint;
wait for `retry-after` seconds when supplied. `anthropic-ratelimit-*` headers expose requests,
input/output tokens, remaining and reset. Tier spend-cap `429` lacks `retry-after`; user-set spend
limits can instead return `400`. Higher tiers/custom agreements change budgets. [ANT]
Acceleration limits and `529 overloaded_error` are separate from ordinary quota exhaustion; stream
errors can arrive after successful HTTP headers. Retry transient failures with backoff, gradually ramp
load, and stop on spend exhaustion. [ANT-ERROR]

**Google Gemini API (AI Studio, not Vertex AI).** RPM, **input** TPM and RPD apply per project/model,
not per key; some models also have TPD/IPM. Free and paid Tiers 1–3 differ with billing history, and
preview models can be more restricted. Active model rates are delegated to AI Studio, so no universal
numeric RPM/TPM preset is verified here. RPD resets at **midnight Pacific**. Conditional spend limits
use a **rolling 10-minute** window: Tier 1 **$10**, Tier 2 **$50**, Tier 3 **$200**; these are spend,
not token quotas, and not applicable to every account. Capacity is not guaranteed. [GEM]
`429 RESOURCE_EXHAUSTED` covers quota exhaustion; inspect the error detail and any retry guidance
rather than assuming all `429`s have a standard retry header. Google's troubleshooting guidance calls
for checking the tier/quota and reducing requests; retry transient exhaustion with backoff, while a
daily or billing restriction needs reset/account action. [GEM-ERROR]

**Azure OpenAI / Microsoft Foundry.** Keep Azure separate from direct OpenAI. RPM/TPM depend on model,
deployment type, quota tier and allocation. Current docs describe a transition to subscription-level
pools: Global Standard shares across regions for the same model/version; Data Zone Standard shares
within the zone. Legacy regional allocations and rollout status must be explicit. Free and tiered
quotas, retained approved increases and provisioned deployments are distinct; read the deployed quota
instead of selecting a generic “Azure tier.” [AZURE]
As a conversion example, **older chat models: one capacity unit = 6 RPM and 1,000 TPM**; this is not a
default deployment allocation or a ratio for every model. Estimated prompt/output reservation and
short-window enforcement can reject below observed billed TPM. `429` includes quota and temporary
capacity throttling; `x-ratelimit-*` reports effective limits/remaining/reset, and `retry-after-ms`
is in milliseconds. Honor it, otherwise use bounded exponential backoff with jitter and smooth the
ramp. Effective limits can temporarily drop below configured allocation. [AZURE-QUOTA]

**AWS Bedrock.** Quotas vary by AWS account, region, model and invocation mode; distinguish in-region,
cross-region inference and provisioned throughput. Service Quotas/account values are required, not a
single Bedrock RPM. [BEDROCK] `bedrock-runtime` can combine RPM, model TPM and account-wide TPD.
Quota accounting reserves input plus requested output, adjusts during execution and reconciles at
completion. Cache reads do not consume that token budget. For the documented **Claude Sonnet 4**
example, **1,000 input + 100 output consumes 1,500 quota tokens** because output burns **5×**;
other model versions use different factors. `bedrock-mantle` has separate input/output quotas, so this
formula must not cross endpoint families. [BEDROCK-TOKENS]
`429 ThrottlingException` differs from `503 ServiceUnavailableException` and
`400 ServiceQuotaExceededException`; no universal rate/reset header is verified. [BEDROCK-API]
AWS recommends backoff with jitter for throttling/unavailability, spreading traffic and requesting
appropriate quota increases. Do not route to another region in the simulator as an automatic retry
unless the diagram explicitly models that route. [BEDROCK-ERROR]

### Payments

**Stripe.** Standard live account defaults: **100 requests/s global**, **25/s per endpoint** and
**50 concurrent** global requests; sandbox global **25/s**. Account/endpoint exceptions and negotiated
increases exist. PaymentIntent updates also have **1,000/object/hour**; these are additional budgets,
not a replacement for the global rate. Scope is account plus endpoint or resource as applicable;
Connect account distinctions matter. Short bursts and expensive/long calls can throttle; the server's
exact rate-window/burst implementation is not specified. `429` with
`Stripe-Rate-Limited-Reason` distinguishes `global-rate`, `endpoint-rate`, `global-concurrency`,
`endpoint-concurrency` and `resource-specific`. A `429` without this header can be `lock_timeout`.
Use exponential backoff with jitter and a shared client limiter; reduce simultaneous calls for
concurrency errors and serialize conflicting object mutations. No standard `Retry-After` guarantee
was found on this page. [STRIPE]

**Adyen.** No universal Payments API RPS, concurrency, burst or plan table was verified in the
response/idempotency docs. Numeric limits and their merchant/company/credential/region scope need
contract/support confirmation per product and endpoint. `429` means excessive requests; Adyen
recommends exponential backoff with jitter. Successful HTTP can still contain a payment refusal,
which is not admission throttling. [ADYEN-HTTP]
For retry safety, preserve `idempotency-key`; retry transient responses when `transient-error: true`,
with exponential backoff. A duplicate in progress can return `409`/`422`, error `704`; unavailable
idempotency storage can return `503`, error `703`. The documented idempotency scope is company
account and does not deduplicate across regional endpoints. That is **not evidence of rate-limit
scope**. A standard rate-limit/reset header or `Retry-After` promise was not verified. Do not turn
an ambiguous timeout into a new payment or automatically fall back to non-idempotent submission.
[ADYEN-IDEMPOTENCY]

**PayPal.** PayPal explicitly does **not publish a numeric rate policy**; it adapts to traffic judged
abusive. No published tier/RPS/concurrency/burst or stable enforcement scope is established by this
guidance. Keep limits and scope unknown unless supplied from a contract/measurement; keys are not
independent capacity. Rejection is HTTP `429`, code `RATE_LIMIT_REACHED` (the page's “Unprocessable
Entity” wording must not be mistaken for HTTP `422`). It does not promise rate/reset or `Retry-After`
headers. Vendor mitigations: webhooks/IPN rather than polling, cached OAuth tokens and contacting
support. [PAYPAL] Proposed client fallback: pause and retry transient throttles with bounded backoff;
reuse endpoint-supported idempotency and reconcile payment status before resubmitting an uncertain
side effect. This fallback is our recommendation, not a published PayPal timing schedule.

### Messaging and email

**Twilio.** REST admission is primarily account concurrency, plus product-specific limits such as
Verify per recipient/service safeguards. No universal numeric concurrency/tier/burst default was
verified. `429`, Twilio error `20429`, means the request was not processed and is safe to retry after
backoff. `Twilio-Concurrent-Requests` helps diagnose load; a standard `Retry-After` promise is not
verified. Vendor advice: exponential backoff, queue/throttle REST requests and reduce Verify polling.
Account-specific increases and product policies belong in separate profiles. [TWILIO]
SMS sender/campaign delivery throughput is a different resource from REST acceptance: a successful
API call may queue for delivery. Do not model SMS segments/s as API requests/s or use retry to
duplicate already accepted messages. Delivery-stage profiles remain separate follow-up work.

**SendGrid.** `/v3/mail/send` documents **10,000 requests/s**, with up to **1,000 recipients per email**;
this is an endpoint maximum, not a guarantee for every plan or all SendGrid APIs. Sending entitlements,
account/subuser conditions and effective burst capacity still need confirmation. [SENDGRID-SEND]
Other v3 endpoint limits return `429` until their refresh period ends, with
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. The numbers in header examples are
not defaults. [SENDGRID-RATE] Use the reset information to pace retries, then bounded backoff if
needed (our client recommendation); no universal `Retry-After` was verified. Monthly/daily mail
allowances and eventual bounce/suppression are separate from API request admission. Do not invent
a concurrency cap or infer global scope from an endpoint ceiling; confirm account/subuser sharing
before asserting independent capacities.

**Postmark.** Official API overview documents `429` acceptable-use throttling without a universal
numeric send RPS, concurrent cap, burst or plan table. Keep those unknown and confirm effective
account/server/stream scope with support. Server-token and account-token authentication scopes do
not themselves establish independent rate buckets. Rejections also use a JSON `ErrorCode`/`Message`
and `X-PM-ApiErrorCode`; batch sends can return individual errors inside HTTP `200`. A maximum of
**500 messages per batch** is a payload constraint, not **500 requests/s**. Vendor advice on `429`
is to reduce request rate; standard retry/reset headers are not promised here. [POSTMARK]
Our recommendation is bounded backoff for transient throttles, checking individual batch outcomes
before retries and avoiding resending confirmed successes. Subscription mail volume must remain
separate from request throughput; delivery success is not implied by API acceptance.

**Amazon SES (additional).** A useful event-driven notification case because quotas count
**recipients**, not HTTP requests. Account quotas are separate by AWS region: sandbox permits
**200 recipients per rolling 24 hours** and **1 recipient/s**; production quotas/increases are
account-specific. Short bursts can exceed send rate, but exact burst capacity is not published and
acceptance can be below the ceiling. [SES]
SES quota guidance describes `ThrottlingException` for daily/rate exhaustion and SMTP `454`; it
recommends waiting up to **10 minutes** before retrying. Daily exhaustion still needs capacity to
age out. [SES-ERROR] SES v2 `SendEmail` documents `429 TooManyRequestsException`; preserve API-version
differences instead of imposing a common HTTP error on API and SMTP. No universal `Retry-After`
is verified. [SES-V2] Use one recipient per modelled request initially; multi-recipient accounting
needs the unit extension below. Accepted mail can still fail downstream.

### Other APIs

**GitHub.** REST unauthenticated **60 requests/hour per source IP**; authenticated user **5,000/hour**;
installation baseline **5,000/hour**, with scaling rules; eligible Enterprise Cloud installations
**15,000/hour**. Tokens acting for the same user share capacity. Secondary restrictions include
**100 concurrent across REST and GraphQL**, and **900 points/minute** for REST endpoints; some
point costs/reasons are undisclosed. Search and GraphQL need separate profiles. `403` or `429`
can mean primary/secondary throttling; `x-ratelimit-{limit,remaining,used,reset,resource}` identifies
primary usage. Wait for `retry-after` when present, otherwise primary reset when remaining is zero;
for secondary throttling without either, wait at least **one minute**, then exponentially longer
with bounded retries. Secondary policies may change without notice. [GITHUB]

**Slack.** Web API scope is app × workspace × method, shared across tokens. Method tiers publish
**1+/20+/50+/100+ requests/minute**; these are lower bounds, not exact maxima or paid-plan tiers.
All Slack plans have the same method tier. Special methods differ: `chat.postMessage` generally
**1 message/s/channel**, with a separate workspace budget whose number is not published here.
Burst capacity is intentionally undisclosed. History/replies also depend on commercial distribution
and Marketplace approval; do not collapse them into a “Pro” profile or copy historical rollout
dates into permanent rules. `429` includes `Retry-After` in seconds; pause that method/workspace
for that app, leaving unrelated scopes independent. [SLACK] A conservative model may use the published
minimum with explicit approximation, but must not explain it as Slack's exact enforced cap.

**Shopify.** GraphQL Admin uses cost points per app/store: Standard **100/s**, Advanced **200/s**,
Plus **1,000/s**, enterprise **2,000/s**; single query requested cost is at most **1,000 points**.
The leaky bucket restores continuously; returned `extensions.cost.throttleStatus` supplies
`maximumAvailable`, `currentlyAvailable`, `restoreRate`. Example response bucket sizes are not
universal defaults. Admission reserves requested cost, then refunds the difference from actual cost.
Use returned cost to pace, simplify/batch queries appropriately and wait for restored capacity.
No general concurrent cap is verified. [SHOPIFY]
GraphQL throttling can be HTTP `200` with `errors[].extensions.code = THROTTLED`; inspect the body,
not only HTTP status. Resource throttles can also return `429`; REST Admin has a different request
bucket and must be a different profile. [SHOPIFY-STATUS] Standard `Retry-After` must not be assumed
for GraphQL cost errors. Vendor protection can temporarily lower rates. [SHOPIFY-GENERAL]

**Salesforce.** REST/SOAP platform allocations depend on edition, licenses and add-ons. Long-running
concurrency counts calls lasting **at least 20 seconds**: production/sandbox **25**, Developer/Trial
**5**; shorter calls are not subject to that cap. [SF-LIMITS]
Daily org usage is a **rolling 24-hour soft allocation**, with paid editions such as Enterprise
starting at **100,000 calls** before license adjustments. Exceeding it can continue until an
undisclosed protection threshold returns HTTP `403 REQUEST_LIMIT_EXCEEDED`; it is not an exact
hard daily bucket. API usage headers/limits resources provide remaining allocation. No guaranteed
`Retry-After` or universal burst ceiling was verified. Reduce load, batch/cache eligible operations,
and monitor/reset capacity before retrying; repeated immediate retries cannot restore allocation.
[SF-USAGE] Our profile should report soft-budget risk and require an explicit hypothetical hard cap
for simulations that need one. Do not apply the long-call concurrency ceiling to every request.

**Google Maps.** Split by API/SKU and version, not one Maps quota. Geocoding's page summary gives **3,000 queries
per minute**, while the main usage section delegates the amount to project quotas; treat this as a
published candidate requiring console confirmation. It sums client- and server-side requests, with
configurable daily quotas resetting at **midnight Pacific**; project quota
and approved increases govern effective capacity rather than the number of keys. This is not a
Maps-wide or paid-plan RPS promise; burst/concurrency defaults are not verified. [MAPS]
Geocoding v3 reports body status `OVER_QUERY_LIMIT`; inspect `status` even on a successful HTTP
transport response. `OVER_DAILY_LIMIT` can instead indicate billing/key or self-imposed constraints.
No universal rate/reset or `Retry-After` header is verified here. [MAPS-STATUS]
Google recommends exponential backoff for eligible web-service failures and avoiding synchronized
requests. [MAPS-RETRY] Retry transient quota pressure after pacing; a daily/billing issue needs
reset/configuration changes. This proposal covers Geocoding first; Places/Routes need separately
cited profiles and request-unit definitions.

**Auth0.** Token-bucket limits compose tenant-wide API and endpoint limits, with user/IP-specific
safeguards; plan, tenant type and public/private deployment change policy. Public Free Authentication
API: **300/minute, burst 300**; ordinary `/oauth/token`: **30/s, burst 30**, both apply. Native social
login and exchange operations differ despite sharing that path. [AUTH0-FREE] Extensibility concurrency
is its own resource: Public Cloud **250 per tenant**, not a general cap on every authentication
request. [AUTH0-POLICY] `429`, with `x-ratelimit-limit`, `x-ratelimit-remaining` and
`x-ratelimit-reset`, supports pacing. Respect reset and any returned `retry-after`; avoid retrying
continuously. [AUTH0-RETRY] Use token caching and bounded backoff; do not show identity/config
dependency edges as consuming API quota. Per-user/IP controls need explicit scope/workload data,
not an invented global tenant limit.

**Okta.** Org endpoint rate buckets coexist with principal/token safeguards and concurrency.
Integrator Free concurrency **35**, Workforce/Customer Identity **75**, with Microsoft 365 traffic
tracked separately; active multipliers can increase eligible non-Microsoft 365 capacity. [OKTA-CONC]
Endpoint categories, subscription and purchased capacity determine minute rates; no single numeric
org RPM or universal burst is established. [OKTA-RATE] `429` carries
`X-Rate-Limit-{Limit,Remaining,Reset}`. For concurrent exhaustion, limit and remaining headers can
both be zero and reset is only an estimated recovery time. Vendor guidance is throttle/backoff,
investigate System Log and request appropriate increases; internal retries can soften concurrency
spikes. A new API token does not create a new org allowance. [OKTA-MONITOR]
Initially profile ordinary API traffic only; exclude Microsoft 365 and identity dependencies, and
keep user safeguards separate from the org quota.

**HubSpot (additional).** Publicly distributed OAuth apps get **110 requests/10 seconds per installed
account**, excluding CRM Search. Privately distributed apps: Free/Starter **100/10 seconds per app**
plus **250,000/day per account**; Professional **190/10 seconds**, **625,000/day**; Enterprise
**190/10 seconds**, **1M/day**. Add-ons/exempt endpoints differ. Daily limits are shared across apps
and reset at account-timezone midnight; the short policy includes a rolling window. `429` body
`policyName`/`message` identifies daily versus short exhaustion. `X-HubSpot-RateLimit-*` exposes
interval, maximum, remaining and daily usage; OAuth/search omit some headers. Deprecated Secondly
headers do not establish an enforced cap. Vendor advice is client throttling, caching and batching;
wait for the relevant window/reset, with bounded backoff as our fallback. No universal concurrency
cap, burst beyond the stated window or `Retry-After` promise was verified. [HUBSPOT]

**Iterable (additional; existing stencil).** The API Explorer defines endpoint limits per project,
API key or organization. The overview verifies these scopes, not one numeric RPS or plan table;
retain unknown rates until the selected endpoint's evidence is captured. `/api/events/track` shares
project capacity across integrations; asynchronous export can share org capacity across projects.
Legacy ways of supplying credentials can be more restricted. `429` triggers vendor-recommended
exponential backoff; no universal burst, concurrency or retry/reset header was verified. [ITERABLE]
Response code `RateLimitExceeded` identifies rate exhaustion; other failures such as `QueueEmailError`
are different. [ITERABLE-ERROR] Profiles must select product/endpoint/scope and deployment data centre;
no automatic regional quota multiplication. Do not reuse guesses from the earlier planning draft.

**Braze (additional; existing stencil).** REST limits apply per workspace/endpoint and contract.
For `/users/track`, data-point contracts get a burst allowance of **3,000 requests per 3 seconds**;
other contracts are negotiated. The current batch rule permits **75 total objects** across attributes,
events and purchases; legacy per-array rules differ. Do not silently replace the burst-window policy
with an exactly equivalent claim of **1,000/s**. `429` is accompanied by standard
`X-RateLimit-{Limit,Remaining,Reset}` data; if `X-RateLimit-Retry-After` is supplied, wait that many
seconds, otherwise wait for reset. Then resume at a lower rate and batch within contract limits.
No universal concurrent cap or standard `Retry-After` promise was verified. [BRAZE]

**Segment (additional; existing stencil).** HTTP tracking recommends at most **1,000 requests/s per
workspace**; this is a recommendation and Segment may queue excess or return `429`, not a guaranteed
hard admission boundary. Rejections carry `Retry-After` and `X-RateLimit-Reset`, documented here as
seconds until retry (unlike epoch reset headers on other vendors). Higher limits require discussion
with Segment. Separate ingest region and destination capacity; Business regional routing is not
evidence of independent quotas. No universal concurrency, exact burst or plan-wide hard cap was
verified. Normal event requests are limited to **32 KB**, batches **500 KB**; these are payload
limits, not bytes/s quotas. [SEGMENT] Honor retry guidance with bounded backoff and inspect partial
batch outcomes. Model downstream destination throttles independently; accepted ingest is not proof
of delivery to every destination.

## What P3 actually implements

This is based on the current code, not the historical proposal:

- [admission.ts](../../src/model/admission.ts): `Quota` has `id`, `unit`, `amount`, `windowMs`,
  `algorithm: "token-bucket"`, optional `burst`, `sharedGroup`. Units already include `requests`,
  `tokens`, `inputTokens`, `outputTokens`, `costPoints`, `bytes`.
- `ApiBehaviour` already combines `quotas[]`, `maxInFlight`, `sharedConcurrency`, `latencyMs`,
  `errorRate` and `costPerRequest`. `ApiEndpoint.behaviour` adds endpoint-specific requirements;
  node requirements still apply. `PlanningModel.sharedQuotas`/`sharedAllocations` define shared
  budgets. `RetryPolicy` is reserved data, not executed caller behaviour.
- [admissionPolicy.ts](../../src/sim/admissionPolicy.ts) compiles node and endpoint requirements,
  merges per-request cost values and deduplicates repeated shared groups. A shared group identifies
  **one quota**, not an entire account holding all unit buckets. RPM and TPM need different group
  IDs, as do separate windows. Conflicting definitions invalidate the scope.
- [admission.ts](../../src/sim/admission.ts) checks all quotas and concurrent limits before charging
  any; accepted requests consume costs once. Initially full buckets refill in simulation time;
  capacity is `burst ?? amount`. Rejected attempts do not debit buckets. Concurrency is released
  by a lease; token costs are not reconciled/refunded at completion. RPM **plus** concurrency is
  already supported, including across visual nodes. Separate static models are also possible
  using different endpoint budgets or visual nodes and shared groups; no per-model engine is needed
  merely to represent two models with different fixed costs.
- [admissionPlanning.ts](../../src/sim/admissionPlanning.ts) computes a steady-state shared-workload
  ceiling from rates, costs and latency. It excludes bursts, retries and caller waits; it must not
  claim a rolling/day reset forecast. Internal infinity for a missing cap is not evidence of unlimited
  vendor capacity.
- [admissionPresets.ts](../../src/model/admissionPresets.ts) has immutable Lambda, Stripe live/sandbox,
  API Gateway and measured presets at revision `2026-10-14`. Direct OpenAI/Claude currently use generic
  measured/unknown admission, not a verified vendor-tier table. Stripe's endpoint limit is not
  automatically installed by the whole-node preset. [profiles.ts](../../src/stencils/profiles.ts)
  already records evidence/source/checked dates and explicitly calls undocumented burst an assumption.
  [AdmissionFields.tsx](../../src/planning/AdmissionFields.tsx) already has preset selection and Advanced.
- [admissionSchema.ts](../../src/model/admissionSchema.ts) bounds quota arrays and permits windows
  through a day, but only the token-bucket algorithm; monthly/calendar/rolling semantics do not follow
  from a long `windowMs`. `requests` cost is fixed at one; no recipient unit exists.

### Per-vendor mapping

`Q(unit)` below means a `Quota` in `api.quotas` with its native amount/window, separate quota identity
and explicit fidelity. Shared account identifiers are user-owned local labels, never credentials.
Endpoint behaviour refers to the existing file contract; optional endpoint authoring remains P6.

| Vendor         | Existing P3 fields to use                                                                                                   | Fidelity boundary / smallest next step                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI         | `Q(requests)`, `Q(tokens)` and daily quotas where known; `costPerRequest.tokens`; distinct org/project/model `sharedGroup`s | No exact burst inferred from RPM; preserve requested-output estimation. Failed-attempt charging and ramp policy need later work.                                       |
| Anthropic      | `Q(requests)`, `Q(inputTokens)`, `Q(outputTokens)`; separate per-model/workspace groups and token costs                     | Fixed uncached-input/output workload is an approximation; cache-aware adjustments, output-time charging and acceleration are not implemented.                          |
| Gemini         | `Q(requests)`, `Q(inputTokens)` and project/model groups for supplied active quotas                                         | RPD needs Pacific calendar reset; spend rolling windows require dated user prices and a spend unit. Do not encode dollars as tokens.                                   |
| Azure OpenAI   | Request/token quotas and `costPerRequest.tokens`; subscription/model/version/deployment/zone group labels                   | Deployment allocation and parent pools can compose already; retain rollout scope. Estimated reservation and temporary effective-cap changes need explicit assumptions. |
| Bedrock        | Request/token quotas; account/region/model/mode groups; precomputed weighted `costPerRequest.tokens`                        | Constant burndown can be precomputed; reservation/reconciliation, different day/minute accounting and account TPD need richer costs/windows.                           |
| Stripe         | Global plus endpoint `Q(requests)`, `maxInFlight`/`sharedConcurrency`, resource groups when statically known                | Current fields compose correctly; published burst/window internals remain unknown. Dynamic object locks/resource identity need scoped workloads, not a guessed cap.    |
| Adyen          | User-supplied request/concurrency budgets and endpoint behaviour                                                            | Leave unknown until contract and scope are supplied; idempotency/business refusal is not a quota algorithm.                                                            |
| PayPal         | User-supplied `Q(requests)` or `maxInFlight`, scoped only with evidence                                                     | Adaptive unpublished protection cannot become a verified numeric profile.                                                                                              |
| Twilio         | `maxInFlight`, `sharedConcurrency`, endpoint quotas for supplied product limits                                             | REST concurrency fits; sender/campaign delivery queues are a separate resource, not this API bucket.                                                                   |
| SendGrid       | Endpoint `Q(requests)`; account/subuser groups only when verified                                                           | Refresh-period windows and mail-volume units need explicit support; recipient payload cap is validation metadata.                                                      |
| Postmark       | Unknown or measured quotas/concurrency, endpoint cost assumptions                                                           | Per-item batch outcomes and effective scope must be explicit; no invented default send rate.                                                                           |
| SES            | `Q(requests)` only with one recipient/request and explicit label                                                            | Rolling-day quota plus `recipients` unit for batches; general sending throughput is not API call throughput.                                                           |
| GitHub         | Hour `Q(requests)`, secondary `Q(costPoints)`, shared concurrent allocation; endpoint costs                                 | Hour reset/secondary policy is not a continuously refilled hour bucket. CPU safeguards remain unsupported; fixed endpoint point costs can be supplied.                 |
| Slack          | Per-method quotas and channel/workspace groups when budgets are known                                                       | Method tiers are lower bounds. Unknown burst/workspace cap remains visible; channel identities must be explicit, no global per-second claim.                           |
| Shopify        | `Q(costPoints)`, `costPerRequest.costPoints`, app/store group, measured `burst`                                             | Continuous leaky-credit accounting can use P3 token buckets; requested/actual refunds and a separate per-query cost maximum cannot.                                    |
| Salesforce     | User-assumed request budgets; concurrency only in a declared all-long-call scenario                                         | Soft rolling allocation and concurrency conditional on elapsed duration cannot be labelled exact; report risk until supported.                                         |
| Maps Geocoding | Project/API `Q(requests)` and supplied daily budget                                                                         | Minute rate is an approximation until window policy is verified; Pacific daily reset needs calendar-window support; confirm the minute amount in the console.          |
| Auth0          | Tenant API and endpoint quotas with explicit documented `burst`; tenant/endpoint/user/IP group labels                       | Ordinary token flow fits P3. Same-path grant variants need distinct workload identity; extensibility concurrency is separate from API admission.                       |
| Okta           | Endpoint request quotas plus ordinary-org shared concurrency                                                                | Separate Office traffic and principal buckets; vendor internal retries and multiplier changes are not P3 behaviour.                                                    |
| HubSpot        | App short quota plus account day quota, endpoint exceptions                                                                 | Rolling short window and account-timezone daily reset need window support; exemptions must not inherit inapplicable global budgets.                                    |
| Iterable       | Endpoint `Q(requests)` and project/key/org `sharedGroup` after evidence                                                     | Unknown defaults stay unknown; no new engine feature needed for static endpoint sharing.                                                                               |
| Braze          | Workspace/endpoint request quota; explicit contract and batch assumptions                                                   | Burst-window approximation until exact window policy is verified/supported; no copying one contract to all tiers.                                                      |
| Segment        | Workspace request quota labelled recommendation/user assumption                                                             | Vendor queue-or-reject behaviour cannot be represented as guaranteed P3 hard rejection. Model destinations separately.                                                 |

### Minimal extensions, ordered by need

1. **Profile metadata and scope binding, no algorithm change.** Add a registry wrapper and persisted
   selection/snapshot. Translate a scope tuple into one opaque `sharedGroup` **per constraint**.
   Org RPM, project RPM and model TPM are simultaneous independent requirements. One endpoint/model
   per workload class suffices initially; only add a model/grant selector on a call when P6 traffic
   mixes require it. Do not make every vendor string a new simulation role.
2. **Explicit window policy.** Extend the quota algorithm union with fixed-window, rolling-window and
   calendar-window policies, including an anchor/timezone where applicable and initial usage. A
   calendar day must handle daylight-saving boundaries; an hour header reset is an instant, not a
   refill rate. Keep token buckets the legacy default. Use bounded timestamp/cost histories for rolling
   windows and shared evaluation in planning/playback. Without initial usage, state “starts empty of
   prior usage” rather than pretending to know today's remaining allowance. For long windows show
   usage/horizon forecasts, not a precise permanent throughput derived by dividing daily allocation.
3. **Per-constraint costs and reconciliation.** Current costs are per unit, which cannot express two
   different charges in the same unit for different windows. Propose declarative cost references per
   quota, a workload cost vector (uncached input, cache write/read, requested output, actual output,
   recipients) and an admission charge/reservation receipt. Admission must still be atomic; completion
   can reconcile exactly once, cancellation must release reservations correctly, and any debit greater
   than reserve must have defined bounded debt semantics. Reuse `tokens` for model-specific weighted
   token arithmetic; add `recipients` only when modelling multi-recipient sends. Do not misuse
   `costPoints` for dollars; spend controls require a separate priced currency unit and dated prices.
   Defer streaming incremental metering until completion semantics can support it honestly.
4. **Separate constraints from response explanations.** Add stable structured reasons referencing
   profile/constraint/scope, with vendor status/body-code/header metadata for teaching. Do not emulate
   HTTP, execute expressions from profiles or turn all rejections into random `errorRate`. Retry header
   units and reset representation must be typed (seconds, milliseconds, epoch, duration). Failed-attempt
   charging requires an explicit ordered charging policy; P3's no-debit rejection remains the default.
   Metadata can ship first; actual caller retry execution remains item 10 and needs its own integration.
5. **Later, evidence-driven constraints only.** Soft allocation warnings (Salesforce), age-qualified
   concurrency, per-query hard maxima (Shopify), dynamic keyed limits (channel/user/object), queued
   acceptance and ramp/acceleration policies are distinct. Introduce a small conditional constraint
   only when a verified profile/test requires it; never approximate these silently with all-request
   concurrency. Adaptive undisclosed protection stays unsupported. Capacity/reserve/price uncertainty
   must remain visible even after richer algorithms ship.

These are proposed semantics, not new `diagrams/v1` fields accepted by the current schema. Every semantic
extension needs a planning revision/capability warning and tests across engine, planner, schemas,
agent tools and viewer; unsupported readers must not silently run a simpler simulation.

## Proposed profile data format and lifecycle

Keep an immutable, versioned, lazy-loaded catalog, compiled into the static app; it needs no backend,
API key, account connection or external fetch. Retain existing generic presets and their revisions.
Separate catalog schema version, immutable profile revision, vendor tier/model identity and the engine
capabilities required to interpret it. This illustrative wrapper is **not** an existing file contract;
the `api` fragment inside it uses existing P3 fields:

```json
{
  "schemaVersion": 1,
  "id": "stripe.standard.live",
  "revision": "2026-10-15.1",
  "vendor": "stripe",
  "product": "payments-api",
  "tier": "standard",
  "environment": "live",
  "requires": ["admission:p3"],
  "checkedAt": "2026-10-15",
  "reviewAfter": "2027-01-13",
  "sources": [
    {
      "id": "stripe-rate",
      "url": "https://docs.stripe.com/rate-limits",
      "title": "Rate limits",
      "accessedAt": "2026-10-15",
      "section": "Rate limits; Concurrency limits"
    }
  ],
  "scopeBindings": { "account": "user-local-account-label" },
  "api": {
    "quotas": [
      {
        "id": "global-rate",
        "unit": "requests",
        "amount": 100,
        "windowMs": 1000,
        "algorithm": "token-bucket",
        "burst": 100,
        "sharedGroup": "bound-account-global-rps"
      }
    ],
    "maxInFlight": 50,
    "sharedConcurrency": "bound-account-concurrency"
  },
  "evidence": [
    {
      "path": "api.quotas[0].amount",
      "kind": "published-default",
      "sourceIds": ["stripe-rate"]
    },
    {
      "path": "api.maxInFlight",
      "kind": "published-default",
      "sourceIds": ["stripe-rate"]
    },
    {
      "path": "api.quotas[0].algorithm",
      "kind": "assumption",
      "note": "Token-bucket approximation; server window internals not verified."
    },
    {
      "path": "api.quotas[0].burst",
      "kind": "assumption",
      "note": "One second of credit for this scenario; not a published burst allowance."
    }
  ],
  "unknowns": ["latency", "account exceptions", "endpoint exceptions"],
  "coverage": "global limits only; endpoint budgets must also be selected"
}
```

The numeric global defaults in that example come from [STRIPE]; the burst is deliberately labelled an
assumption. Revision, schema, review dates and all test scenario numbers in this proposal are design
choices, not vendor claims. Real scope labels/groups are materialized for the user's diagram, not
shared across unrelated diagrams. Repeated account labels bind the same budgets; separate accounts
require an explicit choice, not duplication of a stencil. Schema validation rejects incompatible shared
definitions and empty/invalid identifiers; it never lets an amount for one unit override another.

Each applicable constraint must carry source IDs/date and evidence, including published lower bounds,
contract-only and unknown values. Unknown numeric values are omitted, with a reason and input hint,
never encoded as zero or infinity. Store applicability and exclusions (endpoint, model family/version,
service tier, region/zone, contract era, grant type), rejection metadata and unsupported features beside
constraints. Numeric fields from example responses are marked examples, unavailable as defaults.
Measurements carry the user's measurement date/source and workload; they do not become vendor evidence.
Latency, failure probability and workload token/point sizes remain measured or explicit assumptions.

On selection, persist the profile identity/revision, resolved numeric snapshot, evidence/coverage and
field-level overrides in the diagram. Explicit user values win; changed fields say **Custom**. Loading
an old diagram resolves its saved snapshot without updating it. If the catalog revision is missing,
retain the snapshot and warn; if the required semantics are unsupported, preserve the document but
disable that result with an explanation. Updating a profile previews changed values, sources, coverage
and effects on shared scopes, preserves overrides, and applies as one undoable action. The diagram's
planning revision gates semantics, independent of a catalog data revision.

Proposed freshness policy: review volatile LLM profiles after **30 days**, other numeric profiles after
**90 days**; retire/deprecate immediately on known product changes. These intervals are maintenance
choices, not vendor expiration dates. The inspector computes “Needs review · checked DATE” locally
from `reviewAfter`; fake-clock tests cover the boundary. Freshness is UI metadata and must not change
deterministic playback, exported results or parity by the wall clock. A changed upstream contract can
be flagged by a new catalog revision, but the offline browser cannot discover upstream changes on its
own. A successful link check verifies reachability, not truth of a quota. Updates require source review,
a new immutable revision and a catalog diff; do not extend checked dates automatically.

## Inspector and explanations

Use the existing admission inspector. Replace/extend **Preset** with **Profile** selection including
**Measured / custom**; the vendor stencil preselects its vendor, a generic API can search vendors. Once
chosen, show the relevant **Tier / model** choice only where it changes the limits; an environment or
deployment qualifier is necessary for Stripe/Azure, not another permanent field for every API. Present
compound choices where that keeps the surface small. Do not silently choose an account tier from a logo.

At rest keep the profile summary, the most useful workload/latency inputs and at most the existing
four main admission controls. Put scope binding, all individual quotas, source/date, burst assumptions,
coverage and override/reset actions in Advanced. Selecting a profile is the primary action, applied in
one undo step; live edits follow the existing admission restart/reconfiguration rules. Shared account
scope is shown in a short read-only hint even when Advanced is closed. Do not add a top-bar control,
profile wizard or credential entry. A collapsed Advanced must not hide an unknown/stale warning.

Show **“Published defaults for [product / tier / model]. Measure your own account and workload.”**
with **“Checked 2026-10-15”**, and “Limits not published—enter your measured or contracted limits”
where appropriate. A profile with only recommendations says so, and partial coverage names the missing
limit class. Preserve unknowns in readouts rather than promising “unlimited.” No networking is needed;
sources open only on explicit user action. Profile data/explanations load with the inspector/planning
code, preserving the startup chunk budget. UI implementation uses `t()` keys and [I18N](../I18N.md).

An explanation should name the binding vendor constraint in native units, aggregate **all** callers in
its scope, and keep the workload assumption adjacent. Proposed examples (flow demands are invented):

- “OpenAI Build · Astra/Sol/Terra: 5,000 RPM; this account's flows need 7,200 RPM. Reduce calls or request
  a higher limit. Token demand is based on your declared workload.” The published RPM is from [OAI];
  do not display the user's illustrative ‘tier 2’ label as today's verified tier name.
- “Stripe live: 50 concurrent requests; these flows need about 60 at your measured duration.” [STRIPE]
  Offer reducing concurrent calls or confirming a higher allocation, never adding Stripe replicas.
- “Shopify Standard: 100 points/s; this flow needs 160 points/s at your declared query cost.” [SHOPIFY]
  Do not call this 100 requests/s or confuse query cost with bucket capacity.
- “Slack method tier 2: published minimum 20/minute. Your flow needs 30/minute; confirm your effective
  limit.” [SLACK] This is uncertainty, not a proven overload finding.
- “PayPal: limit not published. Capacity cannot be established from this profile.” [PAYPAL]
- “Salesforce: declared daily allocation exceeded; protection threshold unknown.” [SF-USAGE]
  A soft-risk finding must not predict an exact rejection count.

In Live, retain **rejected/throttled** separately from failed/dropped/blocked and keep vendor reason in
details/trace. A displayed rejection code teaches the vendor contract; it does not imply real HTTP
calls or upstream failure propagation. No retry button claims to execute the reserved caller policy.
Presentation and exports show readable assumptions without adding editing chrome.

UX review of this proposal: no additional global control, default path is a single contextual profile
pick, unknown/stale state visible, detailed scope one step away, native units and one actionable result.
Implementation must still undergo the repo's app-wide UX review, keyboard/accessibility and overlap
checks; this document is not a rendered UI review.

## Phasing and acceptance tests

Each row is a small PR or a deliberately separate pair. Every fix gets a regression demonstrated to
fail when the fix is temporarily removed. Use simulation/fake clocks and operation counts; performance
tests use same-run ratios per QUALITY, never millisecond budgets or sleep-based assertions.

| PR                                           | Deliverable                                                                                                                 | Acceptance tests / review gate                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5a: evidence catalog                        | Versioned wrapper, snapshots, coverage and source validation; Stripe and measured/unknown templates first; no engine change | Missing official citation/date on any published amount fails validation; unknown is not zero/unlimited; example header values cannot be defaults. Two different quota units/windows get distinct bound group IDs. Unchanged legacy diagrams and every existing parity golden remain identical.                                                                                                                                                                       |
| P5b: contextual selection                    | Inspector profile/tier/model selection, override/undo, scope hint, freshness and explanation names                          | Production Playwright uses only `data-testid`: choose, edit one limit, reload, undo/redo, switch profile preserving overrides, missing revision, stale badge with fake clock, keyboard focus and narrow-panel layout. No added top-bar chrome; lower bounds/partial profiles produce uncertainty, not false overload. Include i18n and UX review.                                                                                                                    |
| P5c: P3-compatible vendor batches            | Separate small data PRs for payments, direct LLMs, messaging and SaaS; only verified/applicable constraints enabled         | Atomic simultaneous request/token/concurrency exhaustion; endpoint plus global cap; shared accounts across visual nodes; separate accounts independent; different model groups share only intended parent budgets. Unknown token cost stays unknown. Test schema/agent/native/HTML round-trip, pin old revision and snapshot when catalog updates. No caller retry execution.                                                                                        |
| P5d: window semantics                        | Fixed/rolling/calendar windows and initial usage; separate algorithm PR from affected profile-data PR                       | A rolling-window burst that a continuously refilled day bucket would wrongly admit is rejected; calendar reset occurs only at anchored boundary, Pacific DST days covered; shared scope debit atomic; initial usage retained; pause/replay independent of wall clock. Planner presents horizon/remaining estimates. Unsupported older reader warns.                                                                                                                  |
| P5e: workload accounting                     | Separate unit/per-quota cost PR, then reserve/reconcile PR and vendor adoption                                              | Requested Shopify cost reserves before execution, refunds once; Bedrock weighted tokens differ from billing tokens; Anthropic input/output and cache costs stay separate. Completion/cancellation/replay cannot double refund, and concurrent failed admission leaves budgets consistent. Recipient batches cost recipients; oversize single query is a validation constraint, not a refill failure. Extend seeded invariants and operation-count/complexity checks. |
| P5f: advanced constraints, only as justified | Soft allocations, long-call concurrency and structured vendor reasons, each independently reviewable                        | Salesforce short calls do not consume long-call allowance; soft budget crossing alone does not force rejection; protocol fixture distinguishes HTTP throttle, body-level throttle, billing exhaustion and business refusal. Retry metadata tests preserve header units. Execute caller retries only through separately approved item 10 work.                                                                                                                        |
| P5g: maintenance and offline portability     | Review tooling, obsolete profile revisions, viewer compatibility and update preview                                         | Catalog revisions never mutate saved values; stale metadata does not affect output parity; offline import/playback/export works without vendor requests; incompatible revision disables misleading result; built output and startup split/size gates still pass.                                                                                                                                                                                                     |

Every user-visible implementation batch ships or extends an invented public showcase that demonstrates
the new profile within about **10 seconds** of Live. Use feature tags in existing `shows` metadata,
examples tests and intentional parity goldens. Suggested scenario: a generic order queue feeds two
payment workers sharing one Stripe account; a planned burst hits the endpoint/global or concurrent
limit and explains why replicas cannot increase vendor allocation. A separate fictional summarization
flow can show input/output token limits. Seed initial usage/credit explicitly so a long-window profile
can be demonstrated without an artificial clock wait. New test fixtures belong in the Lab.

Before each implementation push, run the full repository gates, full production E2E suite with explicit
ports, and the required post-commit verification script. Numeric/data-only updates still test resolution,
round-trip and relevant behaviour. Use `pnpm schemas` when contracts change and the skill release process
when the viewer becomes stale. Every intentional output change requires `pnpm parity:update`, with
each changed golden explained in release notes and the final report; never update to conceal a failure.
This research changes no runtime output, adds no showcase/code and needs no user-visible release note.

## Rejected or deferred choices

- **One RPS per vendor:** erases token/cost units, combined constraints, time windows and shared scopes.
- **Unlimited when documentation is silent:** confuses missing evidence with capacity. Require input.
- **A new key, node or replica means a new allowance:** false for many account/project/org scopes.
- **Shipping precise burst caps from RPM or header examples:** unsupported; mark an assumption instead.
- **Rebuilding concurrency + RPM or per-model static quotas:** P3 already composes them; spend effort on
  genuine window/accounting gaps and understandable scope binding.
- **Automatic vendor account discovery or remote catalog updates:** unnecessary credentials/networking
  for a browser-only tool; explicit local measurements and bundled revisions preserve reproducibility.
- **A complete retry/streaming/billing emulator in P5:** mixes roadmap scopes and promises unavailable
  semantics; teach documented behaviour now, integrate execution only with its own engine work.
- **All vendors in one first PR, new logos or a global vendor panel:** broadens review/maintenance and
  crowds the editor. Existing stencils/glyphs and inspector selection suffice.

## Official source register

Every entry below was accessed **2026-10-15**. A source establishes only the product/conditions discussed
above; it is not an account entitlement. Numbers may change after that date. Dynamic active limits and
unsupported plan/scope/burst details remain unverified. One Azure URL with an explicit view parameter
failed to render; the linked canonical quota guide did render and supplies the retained claims.

- **OAI** — [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits), accessed 2026-10-15.
- **OAI-ERROR** — [Error codes](https://developers.openai.com/api/docs/guides/error-codes), accessed 2026-10-15.
- **ANT** — [Claude API rate limits](https://platform.claude.com/docs/en/api/rate-limits), accessed 2026-10-15.
- **ANT-ERROR** — [Claude API errors](https://platform.claude.com/docs/en/api/errors), accessed 2026-10-15.
- **GEM** — [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), accessed 2026-10-15.
- **GEM-ERROR** — [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), accessed 2026-10-15.
- **AZURE** — [Azure OpenAI quotas and limits](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits), accessed 2026-10-15.
- **AZURE-QUOTA** — [Manage Azure OpenAI quota](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota), accessed 2026-10-15.
- **BEDROCK** — [Bedrock quotas](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html), accessed 2026-10-15.
- **BEDROCK-TOKENS** — [How tokens are counted](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html), accessed 2026-10-15.
- **BEDROCK-API** — [InvokeModel errors](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html), accessed 2026-10-15.
- **BEDROCK-ERROR** — [Troubleshooting Bedrock error codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html), accessed 2026-10-15.
- **STRIPE** — [Stripe rate limits](https://docs.stripe.com/rate-limits), accessed 2026-10-15.
- **ADYEN-HTTP** — [Adyen HTTP status codes](https://docs.adyen.com/development-resources/response-handling/), accessed 2026-10-15.
- **ADYEN-IDEMPOTENCY** — [Adyen API idempotency](https://docs.adyen.com/development-resources/api-idempotency/), accessed 2026-10-15.
- **PAYPAL** — [PayPal rate limiting guidelines](https://developer.paypal.com/api/rest/reference/rate-limiting/), accessed 2026-10-15.
- **TWILIO** — [Twilio error 20429](https://www.twilio.com/docs/api/errors/20429), accessed 2026-10-15.
- **SENDGRID-SEND** — [v3 Mail Send FAQ](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/v3-mail-send-faq), accessed 2026-10-15.
- **SENDGRID-RATE** — [SendGrid rate limits](https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api/rate-limits), accessed 2026-10-15.
- **POSTMARK** — [Postmark API overview](https://postmarkapp.com/developer/api/overview), accessed 2026-10-15.
- **SES** — [SES sending quotas](https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html), accessed 2026-10-15.
- **SES-ERROR** — [SES sending-quota errors](https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas-errors.html), accessed 2026-10-15.
- **SES-V2** — [SES v2 SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html), accessed 2026-10-15.
- **GITHUB** — [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), accessed 2026-10-15.
- **SLACK** — [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/), accessed 2026-10-15.
- **SHOPIFY** — [GraphQL Admin rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), accessed 2026-10-15.
- **SHOPIFY-STATUS** — [GraphQL Admin status and error codes](https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes), accessed 2026-10-15.
- **SHOPIFY-GENERAL** — [Shopify API limits](https://shopify.dev/docs/api/usage/limits), accessed 2026-10-15.
- **SF-LIMITS** — [Salesforce API request limits and allocations](https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html), accessed 2026-10-15.
- **SF-USAGE** — [Salesforce API limits and monitoring](https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage), accessed 2026-10-15.
- **MAPS** — [Geocoding usage and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing?hl=en), accessed 2026-10-15.
- **MAPS-STATUS** — [Geocoding v3 requests and responses](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding), accessed 2026-10-15.
- **MAPS-RETRY** — [Maps web-service best practices](https://developers.google.com/maps/documentation/places/web-service/web-services-best-practices), accessed 2026-10-15.
- **AUTH0-FREE** — [Auth0 Free Public limits](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-configurations/free-public), accessed 2026-10-15.
- **AUTH0-POLICY** — [Auth0 rate-limit policy](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy), accessed 2026-10-15.
- **AUTH0-RETRY** — [Auth0 rate-limit use cases](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-use-cases), accessed 2026-10-15.
- **OKTA-CONC** — [Okta concurrency limits](https://developer.okta.com/docs/reference/rl2-concurrency/), accessed 2026-10-15.
- **OKTA-RATE** — [Okta rate limits](https://developer.okta.com/docs/reference/rate-limits/), accessed 2026-10-15.
- **OKTA-MONITOR** — [Okta monitoring and troubleshooting](https://developer.okta.com/docs/reference/rl2-monitor/), accessed 2026-10-15.
- **HUBSPOT** — [HubSpot API usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines), accessed 2026-10-15.
- **ITERABLE** — [Getting started with Iterable's API](https://support.iterable.com/hc/en-us/articles/41044692130196-Getting-Started-with-Iterable-s-API), accessed 2026-10-15.
- **ITERABLE-ERROR** — [Iterable response codes](https://support.iterable.com/hc/en-us/articles/39629320560148-API-Response-Codes), accessed 2026-10-15.
- **BRAZE** — [Braze rate limits](https://www.braze.com/docs/api/api_limits), accessed 2026-10-15.
- **SEGMENT** — [Segment HTTP API source](https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/http-api), accessed 2026-10-15.

[OAI]: https://developers.openai.com/api/docs/guides/rate-limits
[OAI-ERROR]: https://developers.openai.com/api/docs/guides/error-codes
[ANT]: https://platform.claude.com/docs/en/api/rate-limits
[ANT-ERROR]: https://platform.claude.com/docs/en/api/errors
[GEM]: https://ai.google.dev/gemini-api/docs/rate-limits
[GEM-ERROR]: https://ai.google.dev/gemini-api/docs/troubleshooting
[AZURE]: https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits
[AZURE-QUOTA]: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota
[BEDROCK]: https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html
[BEDROCK-TOKENS]: https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html
[BEDROCK-API]: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html
[BEDROCK-ERROR]: https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html
[STRIPE]: https://docs.stripe.com/rate-limits
[ADYEN-HTTP]: https://docs.adyen.com/development-resources/response-handling/
[ADYEN-IDEMPOTENCY]: https://docs.adyen.com/development-resources/api-idempotency/
[PAYPAL]: https://developer.paypal.com/api/rest/reference/rate-limiting/
[TWILIO]: https://www.twilio.com/docs/api/errors/20429
[SENDGRID-SEND]: https://www.twilio.com/docs/sendgrid/for-developers/sending-email/v3-mail-send-faq
[SENDGRID-RATE]: https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api/rate-limits
[POSTMARK]: https://postmarkapp.com/developer/api/overview
[SES]: https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html
[SES-ERROR]: https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas-errors.html
[SES-V2]: https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
[GITHUB]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[SLACK]: https://docs.slack.dev/apis/web-api/rate-limits/
[SHOPIFY]: https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
[SHOPIFY-STATUS]: https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes
[SHOPIFY-GENERAL]: https://shopify.dev/docs/api/usage/limits
[SF-LIMITS]: https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html
[SF-USAGE]: https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage
[MAPS]: https://developers.google.com/maps/documentation/geocoding/usage-and-billing?hl=en
[MAPS-STATUS]: https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding
[MAPS-RETRY]: https://developers.google.com/maps/documentation/places/web-service/web-services-best-practices
[AUTH0-FREE]: https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-configurations/free-public
[AUTH0-POLICY]: https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy
[AUTH0-RETRY]: https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-use-cases
[OKTA-CONC]: https://developer.okta.com/docs/reference/rl2-concurrency/
[OKTA-RATE]: https://developer.okta.com/docs/reference/rate-limits/
[OKTA-MONITOR]: https://developer.okta.com/docs/reference/rl2-monitor/
[HUBSPOT]: https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines
[ITERABLE]: https://support.iterable.com/hc/en-us/articles/41044692130196-Getting-Started-with-Iterable-s-API
[ITERABLE-ERROR]: https://support.iterable.com/hc/en-us/articles/39629320560148-API-Response-Codes
[BRAZE]: https://www.braze.com/docs/api/api_limits
[SEGMENT]: https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/http-api
