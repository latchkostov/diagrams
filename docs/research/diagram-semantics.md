# Diagram semantics: relationships beyond message flow

Research for the owner's request (October 2026): add Azure App Configuration, link it to Key Vault,
and let a diagram say "this setting comes from App Config, and that entry is a Key Vault reference
(or isn't, because it isn't a secret)". More broadly, show a service pulling things from different
places, without making the app complicated.

Today every edge means "messages or requests flow here" (`kind: "async" | "sync"`), and the live view
animates every edge. This report covers what architects actually draw beyond flow, how good tools keep
it readable, what's missing from the catalog, what the simulation should do with it, and a phased
design.

**Recommendation in one paragraph:** add one optional edge field, `relation`, with seven values. `flow`
is today's edge and stays the default. The other six (`config`, `secret`, `identity`, `telemetry`,
`deploy`, `depends`) are **dependencies**: they never carry particles. All six share one line style (thin,
dotted, open arrowhead) and differ only by a small glyph and a muted tint. People pick a relationship from
one **Relationship ▸** submenu, which replaces today's "Make sync / Make async" row, so the menu keeps
the same number of rows. When an edge is drawn to a typed stencil, the relationship is inferred: an edge
to Key Vault becomes Secret. One toggle, **Show ▸ Dependencies**, hides them all. The App Config to Key
Vault reference is an ordinary `secret` edge from the config store to the vault. Which settings are
secrets is a short list of keys on the service's config edge, with a lock marker on the secret ones.
Showing outages in the live view (startup-only vs cached vs per-request dependencies) comes in phase 3.

---

## 1. Findings

### 1.1 What architects draw besides data flow

| Relationship                                             | What it means in practice                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Configuration retrieval**                              | The app loads settings at startup and refreshes them on an interval. It keeps the cached values if the store is unreachable.                                                    | App Configuration's provider refreshes on a 30 s default interval. "If a request to App Configuration for change detection fails, your app will continue to use the cached configuration" ([MS Learn, dynamic config][acfg-refresh]). "Applications often rely on configuration to start" ([MS Learn, best practices][acfg-bp]).                                                                                                                                                                                                       |
| **Secret retrieval**                                     | Often resolved once and cached: App Service refetches every 24 h, and the Lambda extension's TTL is 5 min by default.                                                           | App Service "caches the values of the Key Vault references and refetches them every 24 hours" ([MS Learn][appsvc-kvref]). Lambda extension: `SECRETS_MANAGER_TTL` and `SSM_PARAMETER_STORE_TTL` default to 300 s, and the cache is per execution environment ([AWS docs][aws-ext]).                                                                                                                                                                                                                                                    |
| **Config entry referencing a secret**                    | A setting's value is a pointer to a secret store, not the secret itself.                                                                                                        | Azure: the App Config value "is a URI that references the value in Key Vault… Your application is responsible for authenticating properly to both App Configuration and Key Vault. **The two services don't communicate directly**" ([MS Learn][acfg-kvref]). AWS: "Parameter Store **functions as a pass-through service** for references to Secrets Manager secrets", under the `/aws/reference/secretsmanager/` prefix ([AWS docs][aws-ps-sm]).                                                                                     |
| **Identity and auth**                                    | A workload gets a token as itself (managed identity or workload identity) and uses it to reach Key Vault, App Config or a database. Users' tokens are validated against an IdP. | AKS Workload ID exchanges a projected service-account token for an Entra token via OIDC federation ([MS Learn][aks-wi]). Lambda's extension "uses the same credentials as those used to run the Lambda function itself", meaning the IAM execution role ([AWS docs][aws-ext]). SPIFFE issues "short lived cryptographic identity documents" for mTLS and JWT ([spiffe.io][spiffe]). WAF lists an "Identity & access flow diagram" as its own type: "where token issuance occurs, where trust boundaries change" ([WAF][waf-diagrams]). |
| **Control plane vs data plane**                          | The control plane changes things (deploy, provision, sync). The data plane serves traffic and should keep working while the control plane is impaired.                          | AWS Builders' Library: the control plane is "the machinery involved in making changes to a system", and a statically stable data plane "continues working even in the face of a control plane impairment" ([AWS][aws-static]).                                                                                                                                                                                                                                                                                                         |
| **Deployment and ownership**                             | CI/CD deploys to, IaC provisions, an operator syncs, a team owns.                                                                                                               | WAF's "deployment diagram" type ([WAF][waf-diagrams]). Ilograph's relation perspectives exist for "dependencies, ownership, and responsibility", unlike its sequence perspectives for dynamic flows ([Ilograph][ilo-rel]). App Config recommends config-as-code imports from GitHub Actions or Azure Pipelines ([MS Learn][acfg-bp]).                                                                                                                                                                                                  |
| **Observability emission**                               | A service sends logs, metrics and traces to a collector. It's fire-and-forget: the business path doesn't wait on it.                                                            | Common in every reference diagram. The catalog already has 11 observability stencils, all sinks, and examples draw `ingest → App Insights "Traces / exceptions"` as a message flow.                                                                                                                                                                                                                                                                                                                                                    |
| **Network and trust boundaries**                         | Private endpoints, VNet integration, where trust changes.                                                                                                                       | WAF: "don't depict a PaaS service inside a subnet if it's actually accessed over a private endpoint" ([WAF][waf-diagrams]). Threat-model DFDs draw trust boundaries as red dotted lines ([MS Threat Modeling Tool][mstmt]). OWASP: "Boundaries show any location where the level of trust changes" ([OWASP][owasp-tm]). Key Vault references from a VNet-restricted vault need the app's outbound path through the VNet ([MS Learn][appsvc-kvref]).                                                                                    |
| **Schema / contract, DNS, certificates, image registry** | The dependency is needed to start or to connect, but no business messages travel on it.                                                                                         | The catalog already has Schema Registry and DNS as stencils with no clear edge meaning. A CSI secrets mount that can't reach Key Vault leaves the pod in ContainerCreating ([MS troubleshooting][csi-trouble]). This is a startup-only dependency failing in practice.                                                                                                                                                                                                                                                                 |
| **When a dependency is used**                            | At startup only, cached with refresh/TTL, or on every request.                                                                                                                  | The three cases above: 30 s refresh with a stale-on-failure fallback, 5 min TTL, 24 h refetch. App Config also recommends "configuration caching" and "startup retries", or baking config in at release time "to avoid a runtime dependency" ([MS Learn][acfg-bp]).                                                                                                                                                                                                                                                                    |

**Takeaway.** About six recurring non-flow relationships cover nearly every architecture diagram: config,
secret, identity, telemetry, deploy/manage, and a generic "depends on". They differ from flows in two ways
that matter to this app:

1. **No per-message traffic.** Drawing them as particle-carrying edges is wrong. The existing Azure
   example animates a "Get secret" request to Key Vault for every invoice. In reality it's read once and
   cached.
2. **They fail differently.** A dependency outage hurts new instances first and running ones later, or
   never. That is the static-stability story, and a live tool can tell it uniquely well.

### 1.2 How good tools render these without clutter

| Tool / guidance                       | Technique                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C4**                                | "Every line should be labelled… avoiding single words like 'Uses'". Container relationships need an explicit technology. "Every diagram should have a key/legend" ([c4model.com][c4-notation]).                                                                                                                     |
| **C4-PlantUML**                       | `AddRelTag(..., lineColor, lineStyle=DashedLine/DottedLine/BoldLine, legendText)`. Tagged relationships are styled and appear in an auto-generated legend (`SHOW_LEGEND()`) ([C4-PlantUML][c4-plantuml]). A small, fixed vocabulary of tags plus an automatic legend is the pattern to copy.                        |
| **Structurizr**                       | Relationship styles are bound to tags. The default is "dashed grey lines", and a tag sets colour and dashed on or off ([Structurizr][structurizr]).                                                                                                                                                                 |
| **IcePanel**                          | Connections have direction, technology, status and a **Via** object. Flows are separate, step-by-step overlays. Tags highlight on hover, pin, focus or hide, and connections take their first tag's colour ([IcePanel docs][icepanel], [tags][icepanel-tags]). Hover-to-highlight a category is cheap and powerful. |
| **Ilograph**                          | **Perspectives**: the same resources with different relation sets, such as relations for "dependencies, ownership, and responsibility" vs sequence perspectives for flows. Has `via` and `secondary` relations that don't affect layout ([Ilograph][ilo-rel]).                                                      |
| **draw.io**                           | Layers: hiding a layer hides its shapes and connectors. A shape is on exactly one layer. Interactive links can toggle layers in shared diagrams ([draw.io][drawio-layers]).                                                                                                                                         |
| **Azure WAF**                         | "Provide a legend" when line semantics are introduced. "Avoid relying solely on color to distinguish types, instead consistently pair color with pattern." "Layer, don't overload." "Use single-ended arrows… from the initiating component (client) to the dependency (server)" ([WAF][waf-diagrams]).             |
| **AWS conventions**                   | Solid lines for primary connections, "Secondary connections… Dashed lines". Prefer open arrowheads. "Avoid using color as a sole indicator of difference" ([AWS networking conventions][aws-conv]).                                                                                                                 |
| **Threat-model DFDs**                 | Trust boundaries drawn as red dotted lines. Data flows carry protocol and encryption annotations ([MS TMT][mstmt]).                                                                                                                                                                                                 |
| **Mermaid** (we import and export it) | Three link weights: solid `-->`, dotted `-.->` and thick `==>` ([Mermaid docs][mermaid]). Our importer already maps dotted to `async`, so dotted can't also mean "dependency" on its own.                                                                                                                           |

**Patterns that work:**

- **Primary vs secondary weight.** Flows are the main line; dependencies are thinner, lighter and dotted.
  AWS and Structurizr both use this.
- **Pattern + glyph + colour, never colour alone.** WAF and AWS both say this.
- **A small, fixed vocabulary with an automatic legend.** C4-PlantUML does this.
- **Category-level toggles or hover-highlight rather than general-purpose layers.** IcePanel tags and
  Ilograph perspectives work this way. draw.io's free-form layers are powerful but put the burden on the
  user.
- **Direction from consumer to dependency.** WAF says arrows go from the initiating component to the
  dependency.

### 1.3 Gaps in our catalog for these scenarios

From `src/stencils/catalog.ts` (155 stencils):

- The security family is 6 stencils, all `none`: Key Vault, Entra ID, Vault, Okta, Auth0 and Keycloak.
- There is **no config store at all**. Missing: Azure App Configuration, AWS Parameter Store, Kubernetes
  ConfigMap and Consul.
- There is **no workload identity**. Missing: Managed Identity, IAM role and SPIFFE.
- AWS and GCP have no secret stores.
- There is no container registry, and no AWS-native or Azure-native observability backend: CloudWatch and
  Azure Monitor / Log Analytics are missing.
- Prioritized additions are in §2.7.

### 1.4 Simulation: should dependencies matter in the live view?

- **They should never carry particles.** Their traffic isn't per message. Particles would swamp the
  business flow and mislead capacity analysis: Key Vault would show up as a hot node.
- **They can still matter as outages.** The sources give the three behaviours a live view needs:
  - **Startup-only.** A pod with a CSI-mounted secret can't start while Key Vault is unreachable
    ([MS troubleshooting][csi-trouble]). Running pods are unaffected.
  - **Cached with refresh.** App Config keeps cached values when a refresh fails ([MS Learn][acfg-refresh]).
    The Lambda extension serves cached secrets until the TTL expires ([AWS docs][aws-ext]).
  - **Per request.** For example, calling Key Vault on every request without a cache, or online token
    introspection. The service fails while the dependency is down.
- **The scenario this enables:** Key Vault down → new replicas can't start → running replicas keep
  serving. This is static stability ([AWS][aws-static]), and no other diagram tool can show it live.
- **Not MVP.** It needs a notion of replica readiness in the engine. Ship dependencies as
  documentation-only first; the format below already has room for the behaviour.

---

## 2. Recommended design

### 2.1 Vocabulary (add to `docs/UX-PRINCIPLES.md`)

- **Relationship**: what an edge means. It is either a **flow** or a **dependency**.
- **Flow**: today's edges. **Message** (async, dashed) or **Request** (sync, solid). Only flows carry
  messages in Live.
- **Dependency**: any other relationship (Config, Secret, Identity, Telemetry, Deploy, Depends on). Drawn
  dotted, never carries messages.
- The Inspector's "Kind" row becomes **Relationship**. The words "async/sync" stay in hints only.

### 2.2 The relationship set (seven, fixed)

The arrow always points from the thing that needs the dependency to the dependency (WAF). Deploy is the
exception: it points from the actor to the target it changes, which is still the initiator.

| `relation`  | Menu label        | Implicit label (not drawn; used for tooltip, aria, legend and exports) | Line                                                                                     | Glyph (Lucide)       | Tint (light / dark token)     | Live behaviour (phase 3 default)                                                       |
| ----------- | ----------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `flow`      | Message / Request | "message" / "request" (as today)                                       | Today: 1.6 px, `--edge` dashed 5 5 (async) or `--edge-strong` solid (sync), filled arrow | none                 | as today                      | Particles, as today                                                                    |
| `config`    | Config            | "reads config"                                                         | 1.25 px, dotted `1 4` round caps, open arrowhead                                         | `sliders-horizontal` | teal `--rel-config`           | **Cached**: needed to start, then refreshes; a refresh failure keeps the cached values |
| `secret`    | Secret            | "reads secrets"                                                        | same                                                                                     | `key-round`          | amber `--rel-secret`          | **Startup** (cached): needed to start; running replicas unaffected                     |
| `identity`  | Identity          | "gets tokens from"                                                     | same                                                                                     | `id-card`            | indigo `--rel-identity`       | **Cached** with expiry: running replicas keep working until the token lifetime ends    |
| `telemetry` | Telemetry         | "sends telemetry to"                                                   | same                                                                                     | `activity`           | violet-grey `--rel-telemetry` | **None**: fire-and-forget; the backend being down affects nothing                      |
| `deploy`    | Deploys           | "deploys to"                                                           | same                                                                                     | `rocket`             | green `--rel-deploy`          | **None**: control plane; the data plane keeps running                                  |
| `depends`   | Depends on        | "depends on"                                                           | same                                                                                     | `link-2`             | `--edge-strong` (neutral)     | **Startup**                                                                            |

Rules that keep it calm:

- **One line style for every dependency.** The reader learns two things: a thicker line moves messages, a
  dotted thin line is a dependency. The glyph says which kind, and the tint is a third, redundant cue.
  This satisfies "pair color with pattern".
- **The glyph is a 14 px chip.**
  - It sits where the label would go. With a label, the glyph is the pill's leading icon.
  - When labels collapse to numbered dots (existing `dot` mode), the glyph replaces the number.
  - It joins the existing label-placement and overlap audit (rule 10).
- **Tints are desaturated,** at about 60% of the stencil-accent strength. They must pass 3:1 against the
  canvas in both themes; add them to `tokens.css` next to `--edge`.
- **No default text on the canvas.** Seven words like "reads config" on every edge are exactly the C4
  "Uses" problem. The glyph carries the meaning. Typed labels stay the user's ("App Configuration Data
  Reader", "/orders/prod/*"). The implicit label is used for the hover tooltip, the aria label, the legend,
  and Mermaid/draw.io export.
- **Why seven and not more:**
  - Schema, DNS, certificates, registry pulls and private endpoints all fit `depends`, with a label.
  - Ownership ("team owns") is a boundary or note concern, not an edge.
  - The set is closed: no custom relationship kinds. That keeps the legend and the menu bounded.
- **Why `config` and `secret` are separate:** the owner's scenario is precisely telling them apart. They
  also behave differently in phase 3 (refresh vs startup) and audiences read them differently (security
  reviews care about secrets).

### 2.3 Data model and backward compatibility (`diagrams/v1`)

```ts
export type EdgeRelation = "flow" | "config" | "secret" | "identity" | "telemetry" | "deploy" | "depends";

export interface ConfigKey {
  /** e.g. "ConnectionStrings:Orders" or "/orders/prod/table-name". */
  name: string;
  /** True when the value lives in (or references) a secret store: shown with a lock. */
  secret?: boolean;
}

export interface DiagramEdge {
  // ...existing fields...
  /** What the edge means. Absent = "flow" (and then `kind` applies). Non-flow edges carry no traffic. */
  relation?: EdgeRelation;
  /** config/secret edges: the settings read over this edge (phase 2). */
  keys?: ConfigKey[];
  /** Dependencies only: when it's needed (phase 3). Absent = the relation's default (see §2.2). */
  when?: "startup" | "cached" | "request" | "never";
}
```

- **Stays `diagrams/v1`.** Every field is optional, and absent means today's behaviour. No version bump.
- **Older builds keep the new fields.** `src/interop/native.ts` keeps unknown edge fields (`{ ...e }`), so
  a file saved by a newer build and opened by an older one keeps `relation`. It is drawn as a flow, which
  is the safe fallback.
- **Validation in `native.ts`:**
  - Drop an unknown `relation`.
  - Drop `keys` that aren't `{name: string}` arrays, and keep at most 200 keys per edge.
  - Drop `when` unless the edge has a non-flow relation.
  - On non-flow edges, ignore `kind`, `props.group`, `props.dlq`, `filter`, `share` and `emits`. Keep them
    in the file so switching back to flow restores them.
- **No automatic migration.** Existing edges stay flows, and an edge to a Key Vault stays a flow unless
  the user changes it. A one-time inspector hint offers the change (§2.5).
- **Simulation and analysis.** `src/sim/topology.ts` and `capacity.ts` must filter `relation ∉ {undefined,
"flow"}` out of routes. Trace and sequence diagrams ignore them too. This filter is the whole MVP sim
  change.

### 2.4 Catalog: a default relationship per stencil

Add one optional catalog field rather than hard-coding rules in the editor:

```ts
interface Stencil {
  // ...
  /** Relationship inferred for a new edge INTO this stencil (target) / OUT OF it (source). */
  relation?: { in?: EdgeRelation; out?: EdgeRelation };
}
```

- **`in: "secret"`**: `azure.key-vault`, `vault`, and the new secret stores.
- **`in: "config"`**: the new config stores.
- **`in: "identity"`**: `entra-id`, `okta`, `auth0`, `keycloak`, and the new identities.
- **`in: "telemetry"`**: every observability stencil except `opentelemetry`.
  - The OTel Collector is often a real pipeline hop, so leave it as flow and let users switch.
  - Prometheus scrapes rather than receives pushes, but the diagram convention still points service →
    Prometheus. Note this in the tooltip ("scraped").
- **`out: "deploy"`**: `github-actions`, `argocd`, `terraform`, plus new pipeline stencils.
- **`in: "depends"`**: `kafka.schema-registry`, `generic.dns`, and the new registries and certificate
  stencils.
- **Precedence:** the target's `in` beats the source's `out`. The exception is a deploy-source: `out:
deploy` wins, because a pipeline writing to Key Vault is a deploy, not a secret read. When the two ends
  give different answers, prefer the source's `out`.

### 2.5 How a user creates and changes one

The design aims for zero new top-bar controls, zero net new rows in the edge menu, and inference that does
the work.

1. **Draw an edge as today (primary path).**
   - If the target or source stencil has a default relationship, the new edge takes it.
   - The first time each relation is inferred in a session, a toast says **"Secret dependency: no messages
     flow here"**, with **Make it a flow** (undoable). This teaches in place (rule 9).
   - Edges between two services, brokers or stores are never inferred. They stay flows.
2. **Right-click an edge → Relationship ▸** replaces today's "Make sync (request) / Make async (message)"
   toggle, so the edge menu has the same number of rows. The submenu has three groups:
   - Message, Request
   - Config, Secret, Identity, Telemetry
   - Deploys, Depends on

   The current choice is checked, and each row shows its glyph. Flow-only rows (Dead-letter path, Set
   consumer group…) hide for dependencies, so the dependency menu gets _shorter_.

3. **Inspector.**
   - The "Kind" segmented control becomes a **Relationship** select with glyphs. It lists the same 8
     choices as the menu: Message and Request are separate rows, and the 6 dependencies follow.
   - Flow-only fields (consumer group, travel time, filter) show only for flows.
   - Config and secret edges get a **Settings** list (phase 2).
   - **One-time hint.** For a flow edge whose target has `relation.in`, show the hint line "Looks like a
     secret read. Make it a Secret dependency?" with an **Apply** link. This is how the existing Azure
     example's `ingest → vault "Get secret"` gets fixed. Also fix that example by hand when this ships.
4. **Palette (Ctrl+K).** "Relationship › Secret" etc. acts on the selected edge or edges. Multi-select
   plus palette (or right-click on a selection) sets many edges at once.
5. **Mermaid / draw.io round-trip.**
   - **Mermaid.** Dependencies export as `-.->|reads secrets|`, using the user's label when present. On
     import, a dotted link whose label matches a relation's implicit label (or its glyph word) becomes that
     relation; otherwise it stays `async`, as today.
   - **draw.io.** Write `dashed=1;dashPattern=1 4;strokeColor=<tint>;` plus a `dfRelation=secret` style key
     that survives round-trips.

### 2.6 Showing and hiding (layers without a layers panel)

- **Show ▸ Dependencies** goes on the canvas right-click's existing Show submenu, which grows from 5 to 6
  rows. It is also in the View menu and the palette, with shortcut `D` if free.
  - It is one remembered setting, like Show capacity, and is on by default in edit mode.
  - When dependencies are hidden, each affected node shows tiny **dependency pips**: up to 3 glyphs in a
    corner of the card, with "+n" after that. Hover lists them, so the information never disappears.
- **Live view dims dependencies to about 35%** so particles own the stage. They return to full strength
  while their target is down (phase 3) or while hovered. This is a default, not a control.
- **Legend (phase 2).** A compact key appears in the bottom-left only when the diagram uses at least one
  dependency.
  - It lists only the relations used, each with its line sample and glyph.
  - Hovering a row highlights those edges and dims the rest, IcePanel-style. Clicking a row hides or shows
    that relation, giving per-kind toggles without any menu.
  - It is included in PNG/SVG export and in presentation, as C4 and WAF ask for, with an export checkbox
    defaulting to on when dependencies exist.
  - It replaces nothing; it's the only new floating surface, and it collapses to a single "Key" chip.
- **Many config edges.** Ten services, each with edges to App Config, Key Vault, Entra and App Insights,
  is 40 dotted lines. The answers, in order:
  1. **Hide plus pips** (MVP).
  2. **Edges from a boundary (phase 2).** A dependency edge may start at a boundary: "everything in the AKS
     cluster reads App Config". One line replaces ten. This only applies to dependencies; flows still need
     node ends. It needs `native.ts` to accept a group id as `from` when `relation` is set.
  3. **Trunk bundling (phase 4).** Dependency edges with the same target and relation merge into one trunk
     near the target in the router.

### 2.7 The App Configuration → Key Vault reference pattern

The accurate picture comes from §1.1:

- **Azure.** The _app_ reads App Config, gets a Key Vault URI, then reads Key Vault itself with its own
  identity. App Config never calls Key Vault, so the app needs network access and RBAC to _both_.
- **AWS.** Parameter Store _is_ a pass-through for `/aws/reference/secretsmanager/...`, but the caller
  still needs permission on the secret.

In both clouds the reader depends on both stores. So the diagram should show:

```
 Orders API ──config──▶ App Configuration ──secret──▶ Key Vault
    (keys: Features:*, Orders:PageSize,         "2 references"
     [lock] ConnectionStrings:Orders, [lock] Stripe:ApiKey)
```

(In the app `[lock]` is the Lucide `lock` glyph.)

- **Config store → secret store means "entries here reference secrets there".**
  - It's an ordinary `secret` edge, inferred automatically when the source stencil has `relation.in ===
"config"` and the target has `"secret"`.
  - Its implicit label is **"references secrets in"**. When the keys are known, its drawn label is derived:
    **"2 references"**.
  - Its tooltip explains the runtime truth per vendor. Azure: "Your app resolves these with its own
    identity; App Configuration never calls Key Vault." AWS: "Parameter Store passes the request through
    to Secrets Manager."
- **The service → config store edge holds the settings list** (`keys`). Each key has a lock toggle in the
  inspector: locked means "a Key Vault reference", unlocked means "a plain value". This is the single
  source of truth.
  - **Edge label when there's no user label:** a summary, "4 settings · 2 secret" with a small lock. A
    user label wins, and the summary moves to the tooltip.
  - **Hover or selection:** a card lists the keys with lock markers. It reuses the node tooltip component.
    In presentation, clicking the edge shows the card.
  - **The reference edge's label is derived** from the locked keys of every config edge into that store.
    "2 references" changes on its own as keys are toggled.
  - **Editing:** a one-key-per-line textarea in the inspector, where a leading `!` or the lock button marks
    a secret. Pasting a block of keys from `appsettings.json` or `az appconfig kv list` just works. Keep
    the parser forgiving.
- **The direct service → Key Vault edge is optional.**
  - Draw it when you want to show the network path or RBAC, for example with the label "Key Vault Secrets
    User" or via a private endpoint.
  - Leave it out for a clean picture. When it's absent, hovering the reference edge highlights the _implied_
    path service ⇢ Key Vault with a faint ghost line, so the truth is one hover away and never adds
    permanent ink.
  - Phase 3's live view treats the reference as a transitive dependency either way: a Key Vault outage
    reaches every service that reads a referencing config store.
- **"Some keys are secrets, some aren't".** It reads at a glance from the lock count on the summary and on
  the reference edge, then in full on hover. Nothing extra sits on the canvas by default.
- **The same pattern for other stores:**
  - AWS: Parameter Store → Secrets Manager.
  - Kubernetes: ConfigMap vs Secret. These are separate stores, so no reference edge.
  - External Secrets Operator: ESO → Key Vault `secret`, and ESO → K8s Secret `deploy` ("syncs").
    ESO "reads values from external APIs and writes them into Kubernetes Secrets" ([external-secrets.io][eso]).
  - The App Config Kubernetes provider builds "ConfigMaps and Secrets from key-values and Key Vault
    references" ([MS Learn][acfg-bp]). That is the same shape as ESO.

### 2.8 Stencil additions

All use simRole `none`, like today's security family, so that if someone draws a flow to them it passes
through as it does now. The exceptions are noted in the table. Icons come from the sources already
licensed in `docs/ICONS.md`: Azure V24, AWS 2026-07-31, the GCP set, the Kubernetes community icons, and
Lucide for generics. The category column uses "security" for config stores too. Rename the category's
_display_ label to **"Security & config"**. Categories aren't persisted, so this is safe.

| Priority | id                                                                                        | Label                         | Vendor           | Category      | simRole | `relation`    | Why                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------- | ----------------------------- | ---------------- | ------------- | ------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | `azure.app-config`                                                                        | App Configuration             | Azure            | security      | none    | in: config    | The owner's ask. Sublabel "config store".                                                                                                      |
| P1       | `azure.managed-identity`                                                                  | Managed Identity              | Azure            | security      | none    | in: identity  | Every Azure reference architecture shows it. Covers workload identity (sublabel "workload identity").                                          |
| P1       | `aws.secrets-manager`                                                                     | Secrets Manager               | AWS              | security      | none    | in: secret    | AWS counterpart of Key Vault.                                                                                                                  |
| P1       | `aws.parameter-store`                                                                     | Parameter Store               | AWS              | security      | none    | in: config    | Systems Manager Parameter Store; references Secrets Manager.                                                                                   |
| P1       | `aws.iam-role`                                                                            | IAM Role                      | AWS              | security      | none    | in: identity  | Lambda execution role, IRSA, ECS task roles.                                                                                                   |
| P1       | `gcp.secret-manager`                                                                      | Secret Manager                | Google Cloud     | security      | none    | in: secret    | GCP counterpart.                                                                                                                               |
| P1       | `k8s.configmap`                                                                           | ConfigMap                     | Kubernetes       | security      | none    | in: config    | Every Kubernetes diagram; target of the App Config K8s provider.                                                                               |
| P1       | `k8s.secret`                                                                              | Kubernetes Secret             | Kubernetes       | security      | none    | in: secret    | Same; the target of ESO, cert-manager and the CSI driver.                                                                                      |
| P1       | `generic.config-store`                                                                    | Config Store                  | Generic          | generic       | none    | in: config    | For block diagrams, which WAF says should use generic shapes, not logos.                                                                       |
| P1       | `generic.secret-store`                                                                    | Secret Store                  | Generic          | generic       | none    | in: secret    | Same.                                                                                                                                          |
| P1       | `generic.identity-provider`                                                               | Identity Provider             | Generic          | generic       | none    | in: identity  | Same.                                                                                                                                          |
| P1       | `aws.cloudwatch`                                                                          | CloudWatch                    | AWS              | observability | sink    | in: telemetry | The default telemetry target for Lambda; currently missing.                                                                                    |
| P2       | `azure.monitor`                                                                           | Azure Monitor / Log Analytics | Azure            | observability | sink    | in: telemetry | The Azure-native backend besides App Insights.                                                                                                 |
| P2       | `azure.private-endpoint`                                                                  | Private Endpoint              | Azure            | network       | gateway | –             | Lets flows pass through when someone draws service → PE → PaaS. Also used as the `depends` target "private link". WAF's accuracy note applies. |
| P2       | `aws.vpc-endpoint`                                                                        | VPC Endpoint (PrivateLink)    | AWS              | network       | gateway | –             | AWS counterpart. The AWS docs say a VPC Lambda needs one to reach Secrets Manager.                                                             |
| P2       | `azure.acr`                                                                               | Container Registry            | Azure            | compute       | none    | in: depends   | "Pulls image" is the classic startup-only dependency (phase 3 chaos).                                                                          |
| P2       | `aws.ecr`                                                                                 | Elastic Container Registry    | AWS              | compute       | none    | in: depends   | Same.                                                                                                                                          |
| P2       | `generic.container-registry`                                                              | Container Registry            | Generic          | generic       | none    | in: depends   | Same.                                                                                                                                          |
| P2       | `azure.pipelines`                                                                         | Azure Pipelines               | Azure            | generic       | source  | out: deploy   | The deploy source alongside GitHub Actions.                                                                                                    |
| P2       | `external-secrets`                                                                        | External Secrets              | External Secrets | security      | none    | –             | ESO syncs a vault into K8s Secrets.                                                                                                            |
| P2       | `cert-manager`                                                                            | cert-manager                  | cert-manager     | security      | none    | out: deploy   | Issues certificates into K8s Secrets.                                                                                                          |
| P2       | `aws.kms`                                                                                 | KMS                           | AWS              | security      | none    | in: secret    | Encryption keys (SecureString decryption). Azure keys already live in `azure.key-vault`.                                                       |
| P2       | `consul`                                                                                  | Consul                        | HashiCorp        | security      | none    | in: config    | KV config and service discovery.                                                                                                               |
| P3       | `spiffe`                                                                                  | SPIFFE / SPIRE                | SPIFFE           | security      | none    | in: identity  | Workload identity for mTLS.                                                                                                                    |
| P3       | `aws.cognito`, `aws.acm`, `gcp.cloud-monitoring`, `gitlab-ci`, `flux`, `azure.waf-policy` | –                             | –                | –             | –       | as fits       | Long tail. `generic.firewall` already covers WAF for now.                                                                                      |

Add `infer.ts` rules for the new labels, such as `app config(uration)?`, `parameter store|ssm`, `secrets
manager`, `managed identity`, `configmap` and `cloudwatch`. That way draw.io and Mermaid imports pick
them up.

### 2.9 Simulation semantics (phase 3)

MVP is documentation-only: non-flow edges are filtered out of routing, capacity and trace. When the engine
is ready:

- **The `when` field.** Each dependency resolves to one of `startup`, `cached`, `request` or `never`, from
  the edge's `when` or the relation default in §2.2. Users rarely touch it: the inspector shows it under
  Advanced as "Needed: at startup · cached · on every request · never".
- **Reference edges are transitive.** If A depends on config store C, and C has a `secret` edge to vault V,
  then A depends on V with the same `when` as A → C. This matches "the provider resolves references at
  load".
- **Effect on node X while a dependency target is `down` or `paused`:**
  - **`startup`.** Running replicas are unaffected. Replicas that would _become_ active stay **waiting**
    and don't count toward capacity until the dependency is up. That covers a capacity increase, a
    `status` change from down to up (a "restart"), or setup at t=0 with the dependency already down. The
    node shows the badge "2 of 4 waiting · Key Vault down".
  - **`cached`.** Unaffected for `staleAfterMs`: a 5 min default for secrets and tokens, unlimited for
    config refresh with the stale fallback. After that it behaves like `request`. The badge reads "using
    cached config".
  - **`request`.** The node fails every message as if `failureRate = 1`. The existing
    retry/dead-letter/drop machinery then shows the blast radius.
  - **`never`.** No effect.
- **Visuals.**
  - A dependency edge whose target is down turns red, at full strength, with a small "×" on the glyph.
  - No particles, ever. An optional later polish is a single faint pulse along a `cached` edge at each
    refresh, a time cue rather than a message.
- **Engine needs:**
  - `readyReplicas ≤ activeReplicas` per node, consulted where capacity is computed. Checkpoints must
    include it so scrubbing stays deterministic.
  - A compiled dependency graph from `topology.ts`. Expectations gain the metric field `waiting`.
  - Capacity analysis treats waiting replicas as absent when `setup.status` already has the dependency
    down.
- **Timeline presets.** The node right-click in live view (7 rows) gets no new row. Instead, the existing
  **Take down** action on a dependency target narrates itself: "Key Vault is down: running Orders API
  replicas keep their cached secrets; new ones can't start".

---

## 3. Example scenarios

### 3.1 .NET API on AKS: App Configuration with Key Vault references, via workload identity

**Boundaries:** "Azure · prod" (azure tone) containing "AKS cluster" (k8s tone).

**Nodes:**

- `web`: Web Browser
- `fd`: Front Door ("WAF · TLS")
- `api`: .NET Service "Orders API" (sublabel "3 replicas"), inside AKS
- `sql`: Azure SQL "orders-db"
- `sb`: Service Bus Topic "orders.created"
- `appcfg`: **App Configuration** "orders-config"
- `kv`: Key Vault "orders-kv"
- `mi`: **Managed Identity** "orders-api-id" (sublabel "workload identity")
- `entra`: Entra ID
- `ai`: Application Insights

**Edges:**

| from → to    | relation   | label / keys                                                                                                                         |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| web → fd     | flow sync  | HTTPS                                                                                                                                |
| fd → api     | flow sync  | /orders                                                                                                                              |
| api → sql    | flow sync  | EF Core                                                                                                                              |
| api → sb     | flow async | OrderCreated                                                                                                                         |
| api → appcfg | config     | keys: `Orders:PageSize`, `Features:*`, **lock** `ConnectionStrings:Orders`, **lock** `Stripe:ApiKey` → drawn "4 settings · 2 secret" |
| appcfg → kv  | secret     | derived: "2 references" (inferred because config store → secret store)                                                               |
| api → mi     | identity   | "runs as" (inferred: managed identity)                                                                                               |
| mi → entra   | identity   | "federated credential (OIDC)"                                                                                                        |
| api → ai     | telemetry  | (glyph only)                                                                                                                         |

**Reading it.** The two flows are the bold story. The four dotted lines say where the API gets its
settings, its secrets and its identity, and where it reports.

- Hovering `appcfg → kv` ghosts the implied `api ⇢ kv` path. The tooltip reads: "Orders API resolves these
  with its own identity; App Configuration never calls Key Vault."
- A security reviewer turns on the legend's Secret row to highlight just the secret paths.

**Live, phase 3 (simulation "Key Vault outage during scale-out"):**

- **Traffic:** a constant 200/s into `web`.
- **Timeline:**
  1. t=10 s: `kv` down. Note: "Key Vault is down."
  2. t=15 s: `api` props `replicas: 6`. Note: "Black Friday scale-out."
  3. t=40 s: `kv` up.
- **Expectations:**
  - `api` dropped == 0 _always_. It passes: running replicas use their cached config and secrets.
  - `api` waiting == 0 _at_ 45 s.
- **What the audience sees:**
  - The `appcfg → kv` and implied edges turn red.
  - Orders API shows "3 of 6 waiting · Key Vault down", and its backlog grows because capacity didn't
    double.
  - At 40 s the waiting replicas come up and the backlog drains.
  - Message: the outage cost us the scale-out, not the service.

### 3.2 AWS Lambda with Parameter Store and Secrets Manager

**Boundary:** "AWS · eu-west-1".

**Nodes:**

- `client`: Mobile App
- `apigw`: API Gateway
- `fn`: AWS Lambda "checkout-fn" (sublabel "Parameters & Secrets extension · TTL 5 min")
- `ddb`: DynamoDB "orders"
- `ssm`: **Parameter Store** "/checkout/prod"
- `sm`: **Secrets Manager** "checkout/stripe"
- `role`: **IAM Role** "checkout-fn-exec"
- `cw`: **CloudWatch**

**Edges:**

| from → to      | relation  | label / keys                                                                                                                                                          |
| -------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| client → apigw | flow sync | POST /checkout                                                                                                                                                        |
| apigw → fn     | flow sync | invoke                                                                                                                                                                |
| fn → ddb       | flow sync | PutItem                                                                                                                                                               |
| fn → ssm       | config    | keys: `/checkout/prod/table-name`, `/checkout/prod/feature-flags`, **lock** `/aws/reference/secretsmanager/checkout/stripe` → "3 settings · 1 secret"; `when: cached` |
| ssm → sm       | secret    | derived "1 reference". Tooltip: "Parameter Store passes the request through to Secrets Manager; the function's role still needs `secretsmanager:GetSecretValue`."     |
| fn → role      | identity  | "execution role"                                                                                                                                                      |
| fn → cw        | telemetry | logs · metrics                                                                                                                                                        |

**Variant.** Some teams call Secrets Manager directly. Then draw `fn → sm` as `secret` and leave the
`/aws/reference/...` key out. Both pictures are accurate and use the same vocabulary.

**Live, phase 3.** Take Secrets Manager down for 10 minutes.

- Warm execution environments keep serving until their cached secret is 5 minutes old (`cached`,
  `staleAfterMs: 300000`).
- After that, those invocations fail and retries begin.
- Concurrency spikes need new environments, which fail immediately because the secret is a startup
  dependency.

The audience sees the TTL as a real resilience knob.

### 3.3 CI/CD and GitOps: deploy relationships

**Nodes:**

- `gh`: GitHub "orders-api repo"
- `gha`: GitHub Actions "build & push"
- `acr`: **Container Registry** "ordersacr"
- `argo`: Argo CD
- `tf`: Terraform "platform stack"
- `aks`: AKS "prod cluster"
- `appcfg`: App Configuration
- `kv`: Key Vault
- `entra`: Entra ID

**Edges** (all dependencies except the trigger):

| from → to    | relation   | label                                                                             |
| ------------ | ---------- | --------------------------------------------------------------------------------- |
| gh → gha     | flow async | "push to main" (a webhook event: GitHub has no `out: deploy`, so it stays a flow) |
| gha → acr    | deploy     | push image (inferred: `github-actions` `out: deploy`)                             |
| gha → appcfg | deploy     | import settings (config as code)                                                  |
| gha → entra  | identity   | OIDC federated credential, no stored secret                                       |
| argo → aks   | deploy     | sync manifests                                                                    |
| tf → kv      | deploy     | provisions vault + RBAC (source wins over Key Vault's `in: secret`)               |
| tf → appcfg  | deploy     | provisions store                                                                  |
| aks → acr    | depends    | pulls images at startup                                                           |

**Reading it.** One colour (green, rocket glyph) shows every control-plane write, so the reader instantly
sees what can change production.

**Live, phase 3.** Deploy edges are `never`, so taking down GitHub Actions or Argo CD changes nothing in
the data plane. That is the static-stability point, made in one click. Taking down `acr` makes new AKS
replicas wait, because `depends` defaults to `startup`.

---

## 4. Phased implementation plan

### Phase 1 (MVP): the relationship exists, looks right, and gets out of the way

**1. Model.**

- Add `relation` and `EdgeRelation` to `src/model/types.ts` (lead-owned; ask first).
- Add validation in `native.ts`.
- Add `Stencil.relation` and set it on the existing security, observability and deploy stencils.

**2. Rendering.**

- `FlowEdge.tsx` adds the class `fe-rel-<relation>`.
- New tokens `--rel-*` (light and dark).
- Thin dotted stroke, open arrowhead marker `df-arrow-dep`, and the glyph chip with `data-testid="edge-glyph-<id>"`.
- The glyph joins label placement and the overlap audit (`tests/e2e/layout.spec.ts`).
- `edgeAriaLabel` uses the implicit label.

**3. Editing.**

- **Right-click.** Relationship ▸ replaces `edge.toggle-kind`. Flow-only rows hide for dependencies.
- **Inspector.** The Relationship select; flow-only fields hidden for dependencies.
- **Palette.** "Relationship › …" for the selection.
- **Inference.** On connect, with the first-time toast and Make it a flow.
- **One-time hint.** On existing flow edges into typed targets.

**4. Live and analysis.**

- Filter dependencies out of `topology.ts`, `capacity.ts`, the tracer's routes and the Inputs panel.
- Dim them to about 35% in live view.

**5. Show ▸ Dependencies.**

- Remembered pref, View menu and palette.
- Dependency pips on nodes while hidden.

**6. Stencils.** The P1 rows of §2.8, plus `infer.ts` rules. Rename the category label to "Security & config".

**7. Interop.** Mermaid `-.->|implicit label|` round-trip; draw.io `dfRelation`.

**8. Content.**

- Fix the Azure example's `ingest → vault` and `ingest → insights` edges.
- Add one new example built from scenario 3.1 (no simulation yet).

**9. Tests.**

- Unit: native validation, inference precedence, topology filter.
- E2E: the right-click submenu, inference toast plus undo, the Show toggle, Mermaid round-trip. All
  selectors use `data-testid`.

**10. UX gate.** Count the menus. The edge menu should be unchanged or shorter, and Show ▸ should go from
5 to 6.

### Phase 2: say exactly what's read, at scale

**1. Settings on edges.**

- `keys` on config and secret edges: an inspector textarea with lock toggles and paste parsing.
- Summary label ("4 settings · 2 secret").
- Hover or selection card.
- The derived "n references" label on config-store → secret-store edges.
- The ghost implied path on hover.

**2. Legend.**

- Auto, only when dependencies exist.
- Hover highlights a relation; click toggles it.
- Included in export and presentation, collapsible to a "Key" chip.

**3. Edges from a boundary** for dependencies.

**4. P2 stencils.**

### Phase 3: dependencies in the live view

**1. Engine.**

- `when` defaults and transitive references.
- `readyReplicas` / waiting.
- `cached` staleness.
- `request` failure.
- Checkpoint coverage.
- A `waiting` metric for expectations.

**2. Visuals.**

- Red dependency edges and node badges ("3 of 6 waiting · Key Vault down").
- Self-narrating Take down.

**3. Advanced inspector row.** "Needed: at startup / cached / every request / never".

**4. Simulations for the 3.1 and 3.2 examples.**

**5. Update `docs/SIMULATION.md`** with a "Dependencies" section.

### Phase 4: polish, if asked for

- Trunk bundling for same-target dependencies.
- Saved views as presets of relation visibility: Flow, Security, Deployment. This is Ilograph-style
  perspectives without a new concept, because it reuses the legend toggles.
- A threat-model flavour of trust-boundary zones.

### Risks to simplicity, and how to avoid them

| Risk                                                                                    | Mitigation                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kind explosion.** Requests for "ownership", "replicates", "auth via mTLS", and so on. | The set is closed at 7. Everything else is `depends` plus a label. Ownership is a boundary or note. No custom kinds, no user-defined styles.                      |
| **Two overlapping ideas** (async/sync vs relation).                                     | The UI shows one concept, **Relationship**, with Message and Request as two of its options. The file keeps `kind` for compatibility.                              |
| **Dotted-line spaghetti** on real systems.                                              | Thinner and lighter than flows; dimmed in live; Show ▸ Dependencies with pips; boundary-sourced edges; later, bundling.                                           |
| **Colour-only meaning**, an accessibility problem.                                      | Line pattern + glyph + tint, the WAF/AWS rule. The aria label names the relation.                                                                                 |
| **Inference surprises** ("why is my edge dotted?").                                     | It only fires on newly drawn edges into or out of strongly typed stencils. First-time toast with "Make it a flow". It never fires service-to-service. Undo works. |
| **Old diagrams change meaning.**                                                        | No auto-migration. A hint offers the change one edge at a time.                                                                                                   |
| **Chrome creep.**                                                                       | Zero top-bar controls. Edge menu net 0 or −2. Show ▸ +1 row. One conditional floating surface (the legend, phase 2), collapsible.                                 |
| **Settings lists turning edges into spreadsheets.**                                     | Never drawn in full on the canvas: a count summary plus a hover card. A user label replaces the summary.                                                          |
| **Sim complexity leaking into the editor.**                                             | Defaults per relation encode real-world behaviour. `when` lives under Advanced. Phase 3 adds no new mode; only Take down becomes smarter.                         |
| **Mermaid ambiguity:** dotted already means async.                                      | The relation travels in the link label and the round-trip uses it. Unlabelled dotted links stay async, as today.                                                  |
| **Overlap rule 10:** glyph chips are new floating ink.                                  | The chip is part of the label box in the router's placement and in the overlap audit from day one.                                                                |

---

## Sources

- [acfg-kvref]: https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-key-vault-references-dotnet-core (App Configuration Key Vault references: "The two services don't communicate directly")
- [acfg-refresh]: https://learn.microsoft.com/en-us/azure/azure-app-configuration/enable-dynamic-configuration-aspnet-core "30 s refresh, cached on failure"
- [acfg-bp]: https://learn.microsoft.com/en-us/azure/azure-app-configuration/howto-best-practices "references to external data, bootstrap with managed identity, AKS provider, resiliency"
- [appsvc-kvref]: https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references "24 h cache, identity, network-restricted vaults"
- [aks-wi]: https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview "Workload ID, OIDC federation"
- [csi-trouble]: https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/troubleshoot-key-vault-csi-secrets-store-csi-driver "CSI mount failures block pod start"
- [aws-ps-sm]: https://docs.aws.amazon.com/systems-manager/latest/userguide/integration-ps-secretsmanager.html "Parameter Store as a pass-through to Secrets Manager"
- [aws-ext]: https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html "Lambda extension cache and TTL defaults, execution-role credentials"
- [aws-static]: https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones "control plane vs data plane, static stability"
- [aws-conv]: https://aws.github.io/aws-networking-best-practices/community/conventions/ "solid primary, dashed secondary, open arrowheads, not colour alone"
- [waf-diagrams]: https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams "legend, colour plus pattern, arrows to the dependency, layering, private-endpoint accuracy, identity flow diagrams"
- [c4-notation]: https://c4model.com/diagrams/notation "labelled unidirectional relationships with technology; legend"
- [c4-plantuml]: https://github.com/plantuml-stdlib/C4-PlantUML/blob/master/README.md "AddRelTag line styles plus an auto legend"
- [structurizr]: https://docs.structurizr.com/dsl/cookbook/relationship-styles/ "tag-driven relationship styles"
- [icepanel]: https://docs.icepanel.io/llms-full.txt "connections: direction, technology, Via, status; flows; tags"
- [icepanel-tags]: https://docs.icepanel.io/features/perspective-tags "hover highlight, pin, focus and hide by tag; connection colour by tag"
- [ilo-rel]: https://www.ilograph.com/docs/editing/perspectives/relation-perspectives/ "relation perspectives for dependencies and ownership; via; secondary"
- [drawio-layers]: https://www.drawio.com/doc/layers "layer visibility"
- [mermaid]: https://unpkg.com/mermaid@7.0.0/dist/www/flowchart.html "dotted and thick link syntax"
- [mstmt]: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-getting-started "trust boundaries as red dotted lines"
- [owasp-tm]: https://community.owasp.org/Threat_Modeling_Process "DFD elements, trust boundaries"
- [spiffe]: https://spiffe.io/docs/latest/spiffe-about/overview/ "SVIDs, Workload API"
- [eso]: https://external-secrets.io/latest/ "External Secrets Operator"

[acfg-kvref]: https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-key-vault-references-dotnet-core
[acfg-refresh]: https://learn.microsoft.com/en-us/azure/azure-app-configuration/enable-dynamic-configuration-aspnet-core
[acfg-bp]: https://learn.microsoft.com/en-us/azure/azure-app-configuration/howto-best-practices
[appsvc-kvref]: https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references
[aks-wi]: https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview
[csi-trouble]: https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/troubleshoot-key-vault-csi-secrets-store-csi-driver
[aws-ps-sm]: https://docs.aws.amazon.com/systems-manager/latest/userguide/integration-ps-secretsmanager.html
[aws-ext]: https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html
[aws-static]: https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones
[aws-conv]: https://aws.github.io/aws-networking-best-practices/community/conventions/
[waf-diagrams]: https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams
[c4-notation]: https://c4model.com/diagrams/notation
[c4-plantuml]: https://github.com/plantuml-stdlib/C4-PlantUML/blob/master/README.md
[structurizr]: https://docs.structurizr.com/dsl/cookbook/relationship-styles/
[icepanel]: https://docs.icepanel.io/llms-full.txt
[icepanel-tags]: https://docs.icepanel.io/features/perspective-tags
[ilo-rel]: https://www.ilograph.com/docs/editing/perspectives/relation-perspectives/
[drawio-layers]: https://www.drawio.com/doc/layers
[mermaid]: https://unpkg.com/mermaid@7.0.0/dist/www/flowchart.html
[mstmt]: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-getting-started
[owasp-tm]: https://community.owasp.org/Threat_Modeling_Process
[spiffe]: https://spiffe.io/docs/latest/spiffe-about/overview/
[eso]: https://external-secrets.io/latest/
