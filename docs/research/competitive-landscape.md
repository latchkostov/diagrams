# Competitive landscape for Live Diagrams

Research checked **14 October 2026**. Docs only. Product baseline: `origin/master` at
`be7b194`. Prices and product packaging are a dated snapshot, not purchasing advice.

## 1. Summary

**Position Live Diagrams as a private architecture workbench that lets engineers explain and test
message flows before building a system.** Its strongest differentiator is the combination of broker
semantics, explainable capacity sizing, undoable architecture fixes, saved simulation evidence and
portable offline playback. Those capabilities are documented in the [README][ld-readme],
[release notes][ld-release], [simulation model][ld-sim] and [checks research with as-built notes][ld-checks].
This is an assessment of the combination, not a claim that competitors cannot simulate traffic.

### Where it leads

- **Behaviour within an approachable architecture editor.** Queue competition, consumer-group fan-out,
  partition assignment, retries and dead-lettering feed the same diagram's capacity explanations and
  checks. Mainstream competitors' reviewed documentation emphasizes drawing, collaboration, model views
  or cloud discovery; IcePanel Flows and Ilograph sequences explain authored paths rather than documenting
  a load-and-backlog engine. [Live model][ld-sim], [checks][ld-checks], [IcePanel Flows][ice-flows],
  [Ilograph features][ilo-features].
- **Private, portable simulation delivery.** The no-account editor, Private diagrams, encrypted password
  links, password-protected Interactive HTML, host-supplied private embeds and static self-hosting form
  a strong sharing story. Offline drawing and HTML export individually are already competitive territory:
  draw.io, Excalidraw, Structurizr and Ilograph cover parts of it. [Live sharing][ld-interop],
  [embedding][ld-embed], [self-hosting][ld-host], [draw.io][draw-home], [Excalidraw][ex-repo],
  [Structurizr][str-home], [Ilograph][ilo-features].
- **A local path for AI-assisted modelling.** The agent skill produces validated files and offline
  playback without a Live Diagrams API key; supported Chrome installations can make changes on device.
  External agents can still use cloud models and have their own cost and privacy conditions. This is
  a useful distinction from cloud generation, not exclusive ownership of agent integration.
  [README][ld-readme], [on-device model][ld-local-ai], [draw.io MCP][draw-mcp], [Eraser agents][er-agents].

### Where it is at parity

Free/no-account drawing, local files, self-hosting, native cloud-related icons, custom colours, image
exports, Mermaid interchange and presentation are useful capabilities but weak standalone claims of
uniqueness. draw.io and Excalidraw already establish a high free-editor baseline; D2 and Mermaid establish
a strong local code workflow. MCP is now available in draw.io, Lucid, Miro, Figma, Eraser, IcePanel and
Structurizr. WebMCP and a file-based skill are different access paths, not evidence that those products
lack agents. [Live README][ld-readme], [draw.io][draw-home], [Excalidraw][ex-repo], [D2][d2-home],
[Mermaid][mm-guide], [draw.io MCP][draw-mcp], [Lucid MCP][luc-mcp], [Miro MCP][miro-mcp],
[Figma plans][fig-price], [Eraser][er-agents], [IcePanel][ice-mcp], [Structurizr][str-mcp].

### Where it is behind: the five most important gaps

These are **product judgements**, ranked for adoption by engineering teams, not measured market shares.

| Rank | Gap                                           | Why it matters and the relevant benchmark                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Shared review and simultaneous work           | Live's local library and Undo are not shared comments, durable team history or co-editing. Miro, FigJam, Lucidchart and Eraser document these team workflows. Start with portable reviews/history; evaluate opt-in encrypted sessions. [Live][ld-readme], [Miro][miro-price], [FigJam][fig-price], [Lucid][luc-plans], [Eraser][er-price].                                                                                    |
| 2    | One architecture model, multiple C4 views     | Boundaries and separate diagrams do not provide identity-preserving context/container/component views. IcePanel, Structurizr, Ilograph and D2 set the benchmark for reuse and navigation. [Live UX][ld-ux], [IcePanel][ice-price], [Structurizr][str-home], [Ilograph][ilo-features], [D2 C4][d2-c4].                                                                                                                         |
| 3    | A concise diagram-as-code authoring loop      | Native JSON, schemas, agent operations and Mermaid interchange exist; a maintained text model with useful diffs, imports and explicit round-trip limits would lower friction in Git. Mermaid, D2, Structurizr and Eraser already center text authoring. [Live][ld-readme], [Mermaid][mm-guide], [D2][d2-home], [Structurizr][str-home], [Eraser][er-price].                                                                   |
| 4    | Distribution into existing team documentation | Generic embeds and files are foundations, but do not equal installed Confluence/Notion/VS Code/GitHub workflows. draw.io and Eraser document much stronger coverage. [Live embeds][ld-embed], [draw.io integrations][draw-home], [Eraser integrations][er-integrations].                                                                                                                                                      |
| 5    | Template discovery and ecosystem breadth      | Live has narrated examples; it lacks an equally broad, browsable community gallery spanning diagram types and team conventions. Miro advertises thousands of templates, while draw.io and FigJam offer reusable libraries/templates. The opportunity is excellent runnable architecture patterns, not matching a generic shape count. [Live][ld-readme], [Miro][miro-price], [draw.io][draw-whiteboard], [FigJam][fig-price]. |

**Simulation is also becoming crowded.** SysSimulator, TinkerTools, Mutexmachine, System Design Sim and
PRISM all advertise executable system-design exercises or traffic/capacity feedback. Some are free and
require no account. Their numerical accuracy, adoption and operational maturity were **UNVERIFIED** in
this review. The recommendation is to compete on explicit assumptions, event-driven semantics and useful
review evidence, not “the only diagram that runs.” [SysSimulator][sys-home], [TinkerTools][tinker],
[Mutexmachine][mutex], [System Design Sim][sds], [PRISM][prism].

## 2. Method, definitions and product baseline

This is **desk research from official product pages, documentation, maintainer repositories and public
demo descriptions/screenshots**. No competitor was edited or benchmarked hands-on for this report; no
paid accounts were purchased. Earlier repository UX research contains its own historical tests; their
results are not represented here as new hands-on evidence. A documented feature is verified as a vendor
offering/claim, not independently verified implementation quality. Search snippets were used when the
official page's extracted body was incomplete; those limitations are called out below.

- **U means UNVERIFIED:** not established by the cited official sources checked. It does **not** mean
  absent. This includes unknown plan eligibility, absent documentation and unconfirmed launch dates.
- **P means partial/qualified:** read the explanation. A cloud cost estimate is not throughput capacity;
  an animated connector or scripted sequence is not traffic simulation; syntax validation is not an
  architecture best-practice check. A manually drawn C4 diagram is not a reusable multi-view model.
- **Local/offline/no account** are reported separately within their row. “Browser-based” alone proves
  none of them. Likewise a self-hostable viewer or SDK is not a self-hostable team service, and a private
  SaaS workspace is not end-to-end encryption.
- **AI:** built-in cloud generation, a bring-your-own-key option and an external agent generating a text
  file are distinct. MCP denotes the documented scope, not arbitrary diagram control. An API or
  `llms.txt` alone does not establish MCP/WebMCP support.
- The matrix covers advertised product families; paid features are labelled where established. A plan
  comparison whose check marks disappear in text extraction is not used to infer individual entitlements.
  Sources are linked in cells; short source labels resolve to official URLs at the end.
- Dollar amounts below are USD; “annual” means the displayed monthly equivalent with annual billing.
  Taxes, seats, quotas and add-ons can change. Missing or conflicting prices remain U.

Live's baseline uses the current README and release notes to distinguish shipped work from proposals.
In particular, the older [planning proposal][ld-plan], [autoscaling proposal][ld-scale] and
[routing proposal][ld-routing] are not feature announcements. P1/P2 shipped work is recorded in the
release notes. Do not advertise proposed endpoint routing, resource-driven autoscaling or a complete
HTTP deadline/retry model as shipped. [Release notes][ld-release], [simulation contract][ld-sim].

### Live Diagrams: reference column

| Feature                                             | Current baseline and limits                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live traffic/flow simulation                        | Yes: saved scenarios, traffic shapes, failures, broker behaviour, traces and slow-motion replay. Educational/configured model; not execution of the deployed application. [Model][ld-sim], [README][ld-readme].                                                                                                       |
| Capacity planning                                   | Rates, fixed replicas, partition/subscription allocation, heat map, utilization target and sizing arithmetic; assumptions remain user inputs. Not a cloud billing forecast or full production performance model. [Release notes][ld-release], [model][ld-sim].                                                        |
| Architecture or best-practice checks                | Local static checks, undoable fixes, and on-demand Run simulations loss evidence. Not compliance certification or comprehensive model checking. [Checks][ld-checks].                                                                                                                                                  |
| Infrastructure-as-code or cloud import              | Local Compose, Kubernetes, Terraform plan/state JSON, AsyncAPI and draw.io/Mermaid imports. Terraform source HCL is not equivalent to plan/state import; no continuous authenticated cloud discovery established. [Release notes][ld-release], [imports][ld-imports].                                                 |
| Diagram-as-code                                     | P: native JSON/schema and agent skill; Mermaid import/export. No concise canonical DSL editor documented. [README][ld-readme], [interop][ld-interop].                                                                                                                                                                 |
| C4 or multi-level views                             | P: boundaries, dependencies and separate diagrams; reusable C4 view model not documented. [UX][ld-ux], [README][ld-readme].                                                                                                                                                                                           |
| Real-time collaboration                             | Not part of the documented baseline; local editing and file/link sharing. [README][ld-readme].                                                                                                                                                                                                                        |
| Comments and version history                        | Undo/redo and local library, not documented shared comments or durable revision history. [README][ld-readme], [UX][ld-ux].                                                                                                                                                                                            |
| Offline / local-first / no account                  | Local browser storage and files; no account; Interactive HTML playback explicitly offline. Do not conflate that viewer with a guaranteed installed offline editor/PWA. [README][ld-readme], [interop][ld-interop].                                                                                                    |
| Self-host                                           | Yes: static app, optional internal build and host-controlled SSO perimeter. [Hosting][ld-host].                                                                                                                                                                                                                       |
| Privacy controls                                    | Private diagrams gate links, cloud saves and AI; optional on-device permission. Password links/HTML and private host-supplied embeds. Password delivery and the host's access controls still matter. [UX][ld-ux], [interop][ld-interop], [embeds][ld-embed].                                                          |
| AI generation (cloud / API key)                     | Skill needs no Live API key; external agent may use cloud/key/subscription. On-device editing when Chrome/hardware supports it; manual external-chat workflow also exists. [README][ld-readme], [AI notes][ld-local-ai].                                                                                              |
| Agent integration (MCP / WebMCP)                    | WebMCP page tools when supported; portable agent skill and schemas. Not a claim of a general remote MCP service. [README][ld-readme], [AI research][ld-ai].                                                                                                                                                           |
| Shape/icon library breadth and official cloud icons | Curated distributed-system/vendor/API stencils and network glyphs. Azure, AWS and GCP icon sources are documented; other icons include Simple Icons and custom glyphs. Not the complete official catalog of every cloud. [Icons][ld-icons], [release notes][ld-release].                                              |
| Templates                                           | Narrated examples with saved simulations. [README][ld-readme].                                                                                                                                                                                                                                                        |
| Export formats                                      | Native JSON, PNG, SVG, draw.io, Mermaid, Interactive HTML and recorded video; traced sequence diagrams also export. [README][ld-readme], [UX][ld-ux].                                                                                                                                                                 |
| Embeds and integrations                             | Public and host-supplied private embeds. Optional configured Drive/OneDrive/Dropbox storage; disabled in the default production configuration documented in Interop. Native Confluence/Jira/Notion/VS Code app integrations not established. Git can store exported files. [Embeds][ld-embed], [interop][ld-interop]. |
| Presentation mode                                   | Yes; saved narration, slow motion and recording complement it. [README][ld-readme], [UX][ld-ux].                                                                                                                                                                                                                      |
| i18n                                                | English plus 37 additional languages; machine-translation disclosure and some fallback strings. This is not a claim of 38 fully human-reviewed translations. [I18N][ld-i18n], [release notes][ld-release].                                                                                                            |
| Pricing model                                       | Free, MIT-licensed app; own hosting and optional external AI/storage can have costs. [README][ld-readme], [hosting][ld-host].                                                                                                                                                                                         |

### Matrix A: general diagramming and collaborative whiteboards

Lucidscale's column describes its **legacy cloud-model experience and documented migration**. Lucid says
its functionality is moving into Lucidchart cloud frames/Cloud Accelerator; do not assume an unchanged
standalone purchase. [Migration notice, 12 August 2026][luc-scale], [current cloud frames][luc-frames].

| Feature                                             | diagrams.net / draw.io                                                                           | Lucidchart                                                                                                     | Lucidscale / cloud frames                                                             | Miro                                                                                   | FigJam                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Live traffic/flow simulation                        | U                                                                                                | U                                                                                                              | P: cloud visualization, not verified simulation. [L3][luc-scale]                      | U; AI “Flows” are workflows, not evidence of traffic simulation. [M1][miro-price]      | U                                                                                                                   |
| Capacity planning                                   | U                                                                                                | U                                                                                                              | U for throughput planning                                                             | U                                                                                      | U                                                                                                                   |
| Architecture or best-practice checks                | U for semantic architecture checks                                                               | U for broker/capacity checks                                                                                   | P: rule-based views/formatting; automated design fixes U. [L3][luc-scale]             | U                                                                                      | U                                                                                                                   |
| Infrastructure-as-code or cloud import              | P: CSV/Mermaid/file ingestion; cloud account discovery U. [D2][draw-mcp]                         | P: cloud frames via enterprise add-on. [L4][luc-frames]                                                        | AWS/Azure/GCP data import and refresh. [L3][luc-scale]                                | U for native IaC/cloud discovery                                                       | U for native IaC/cloud discovery                                                                                    |
| Diagram-as-code                                     | P: XML, CSV, Mermaid conversion. [D2][draw-generation]                                           | U for canonical DSL                                                                                            | P: view configuration JSON, not a full authoring DSL. [L3][luc-scale]                 | P: Mermaid diagrams. [M1][miro-price]                                                  | P: paste Mermaid into editable diagrams. [F2][fig-connect]                                                          |
| C4 or multi-level views                             | P: C4 shapes, pages; shared semantic model U. [D3][draw-consistency], [D4][draw-whiteboard]      | U for identity-linked C4 model                                                                                 | Multiple filtered views of cloud data; not C4 application modelling. [L3][luc-scale]  | U for semantic C4 views                                                                | U for semantic C4 views                                                                                             |
| Real-time collaboration                             | Yes, storage/deployment dependent. [D1][draw-home]                                               | Yes. [L1][luc-plans]                                                                                           | Shared documents/comments; current entitlement needs migration check. [L3][luc-scale] | Yes. [M1][miro-price]                                                                  | Multiplayer. [F1][fig-price]                                                                                        |
| Comments and version history                        | U for exact provider-dependent coverage                                                          | Yes, versioning plan-dependent. [L1][luc-plans]                                                                | Comments documented; history eligibility U. [L3][luc-scale]                           | Comments via MCP; paid board history. [M2][miro-mcp], [M5][miro-history]               | Comments/history, retention plan-dependent. [F1][fig-price]                                                         |
| Offline / local-first / no account                  | Local files, offline desktop, no signup. [D1][draw-home]                                         | U for fully local/no-account editing                                                                           | Cloud/account workflow. [L3][luc-scale]                                               | Visitor editing can avoid sign-in; offline U. [M1][miro-price]                         | Cloud files; open sessions currently require login. Offline U. [F1][fig-price]                                      |
| Self-host                                           | Docker editor available. [D5][draw-docker]                                                       | U                                                                                                              | U                                                                                     | U                                                                                      | U                                                                                                                   |
| Privacy controls                                    | Bring own storage/local files; separate AI path. [D1][draw-home], [D6][draw-ai-privacy]          | Sharing permissions, password publishing, enterprise controls. [L1][luc-plans]                                 | Credential/data-source sharing controls. [L3][luc-scale]                              | Private boards, guests and enterprise governance. [M1][miro-price]                     | File permissions/private folders and enterprise controls. [F1][fig-price]                                           |
| AI generation (cloud / API key)                     | Hosted cloud generation without own key; BYOK/custom endpoints/clipboard options. [D7][draw-ai]  | Built-in cloud AI; no user-supplied key established. [L1][luc-plans]                                           | Cloud Agent generates from imported cloud data. [L3][luc-scale]                       | Cloud AI credits; no own API key required for built-in path. [M1][miro-price]          | Cloud AI generation/credits; no own API key in built-in path. [F1][fig-price], [F2][fig-connect]                    |
| Agent integration (MCP / WebMCP)                    | Official MCP servers and assistant plugins. [D2][draw-mcp]                                       | Official read/write MCP, not just docs search. [L2][luc-mcp]                                                   | P: Lucid MCP; cloud-frame-specific operations U. [L2][luc-mcp]                        | Official board read/write/comment MCP. [M2][miro-mcp]                                  | Official Figma MCP includes FigJam; plan/rate limits. [F1][fig-price]                                               |
| Shape/icon library breadth and official cloud icons | Broad cloud/network/C4 libraries incl. AWS/GCP/Azure/Cisco. [D3][draw-cloud-icons]               | Broad premium shape libraries. [L1][luc-plans]                                                                 | Provider-resource shapes from imported cloud data. [L3][luc-scale]                    | Advertises 3,900+ diagramming shapes/icons incl. AWS/Azure. [M3][miro-diagrams]        | Advanced AWS/GCP/Azure/Kubernetes shapes; entitlement check needed. [F1][fig-price]                                 |
| Templates                                           | Custom templates and libraries. [D4][draw-whiteboard]                                            | Standard/premium/corporate templates. [L1][luc-plans]                                                          | Built-in cloud-view templates. [L3][luc-scale]                                        | 7,000+ vendor/community templates advertised. [M1][miro-price]                         | Community/custom templates. [F1][fig-price]                                                                         |
| Export formats                                      | PNG/SVG/PDF, editable draw.io. [D1][draw-home]                                                   | PNG/JPEG/SVG/PDF, Visio and data formats; scope varies. [L5][luc-export]                                       | Snapshot/data export; supported formats vary by product. [L5][luc-export]             | JPG/PDF high-resolution exports, plan-dependent. [M1][miro-price]                      | PNG/JPG/PDF; sticky-note CSV. [F1][fig-price]                                                                       |
| Embeds and integrations                             | Confluence/Jira, Notion extension, VS Code, GitHub, Google/Microsoft. [D1][draw-home]            | Marketplace/embeds; exact named connector coverage U here. [L1][luc-plans], [L6][luc-integrations]             | Publish/embed plus Lucidchart hand-off. [L3][luc-scale]                               | 250+ integrations; Jira and embeds; other named integrations U here. [M1][miro-price]  | Live embeds, Notion/Jira and plugins; VS Code is Figma Dev Mode, not proof of FigJam editing there. [F1][fig-price] |
| Presentation mode                                   | P: interactive viewer; dedicated slide workflow U. [D1][draw-home]                               | Slide builder and presenter/follow paths. [L8][luc-present]                                                    | Viewer/views; presenter workflow U. [L3][luc-scale]                                   | Slides/presentation and facilitation. [M1][miro-price]                                 | Spotlight/following; Figma Slides is a separate surface. [F1][fig-price]                                            |
| i18n                                                | Many UI languages enumerated. [D8][draw-languages]                                               | Exact current UI coverage U; built-in AI English-only per plan docs. [L1][luc-plans]                           | UI coverage U; legacy tutorials English-only. [L3][luc-scale]                         | Eight UI languages listed. [M4][miro-languages]                                        | RTL/bidirectional authored text verified; UI language coverage U. [F3][fig-rtl]                                     |
| Pricing model                                       | Free core/desktop; Atlassian integration pricing separate. [D1][draw-home], [D9][draw-atlassian] | Free/Individual/Team/Enterprise; current numeric seat price U (dynamic page). [L1][luc-plans], [L7][luc-price] | Enterprise Cloud Accelerator add-on; quote. [L3][luc-scale]                           | Free; Starter $8, Business $20/member/month annual; enterprise quote. [M1][miro-price] | Free Starter; Professional Collab seat $3/month displayed annual option; higher tiers/credits. [F1][fig-price]      |

### Matrix B: sketching canvases and developer documentation

tldraw.com is the hosted whiteboard; the tldraw SDK is a product-development foundation. SDK capabilities
below are explicitly identified rather than promised as hosted-whiteboard features. Excalidraw+ is the
commercial service, not the same deployment as the open-source editor.

| Feature                                             | Excalidraw                                                                                       | Excalidraw+                                                                                                | tldraw                                                                                                                    | Eraser.io                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Live traffic/flow simulation                        | U                                                                                                | U                                                                                                          | U for architecture simulator; SDK can be extended                                                                         | U                                                                                                                       |
| Capacity planning                                   | U                                                                                                | U                                                                                                          | U                                                                                                                         | U                                                                                                                       |
| Architecture or best-practice checks                | U                                                                                                | U                                                                                                          | U; starter-kit canvas lints are not architecture checks. [T3][tl-agent]                                                   | P: AI rules/presets; deterministic architecture checks U. [E1][er-home]                                                 |
| Infrastructure-as-code or cloud import              | U                                                                                                | U                                                                                                          | U                                                                                                                         | Terraform/file-to-diagram and AWS/Azure/GCP data connections advertised. [E1][er-home], [E5][er-data]                   |
| Diagram-as-code                                     | P: JSON files and Mermaid conversion. [X1][ex-repo], [X2][ex-plus]                               | P: same drawing format and Mermaid input. [X2][ex-plus]                                                    | P: SDK records/snapshots, not an architecture DSL. [T7][tl-persistence]                                                   | Native DSL plus visual/AI editing. [E2][er-price], [E3][er-agents]                                                      |
| C4 or multi-level views                             | U for shared semantic model                                                                      | U                                                                                                          | U                                                                                                                         | U for reusable C4 model                                                                                                 |
| Real-time collaboration                             | Yes. [X1][ex-repo]                                                                               | Yes, team workspaces. [X2][ex-plus]                                                                        | Yes via tldraw sync; production SDK sync must be hosted. [T1][tl-sync]                                                    | Yes. [E2][er-price]                                                                                                     |
| Comments and version history                        | U; local undo is not shared history                                                              | Comments verified; exact version-history coverage U. [X2][ex-plus]                                         | SDK persistence available; hosted comments/history U. [T7][tl-persistence]                                                | Comments; 7-day free, 90-day Starter, unlimited Business history. [E2][er-price]                                        |
| Offline / local-first / no account                  | Local-first, offline PWA and no-account drawing. [X1][ex-repo]                                   | Cloud workspace/account; underlying free editor remains available. [X2][ex-plus]                           | P: local SDK persistence; hosted no-account/offline guarantees U. [T7][tl-persistence]                                    | Cloud/team/account workflow; offline U. [E2][er-price]                                                                  |
| Self-host                                           | Open editor/app source; collaboration backend needs separate setup. [X1][ex-repo]                | U for hosting the Plus service                                                                             | SDK can be hosted anywhere under licence; sync self-hosted. [T1][tl-sync], [T2][tl-price]                                 | P: agent toolkit self-host advertised; complete editor deployment scope U. [E1][er-home]                                |
| Privacy controls                                    | End-to-end encrypted collaboration, local autosave. [X1][ex-repo]                                | Workspace/view permissions; do not infer all Plus storage is E2EE from free-room encryption. [X2][ex-plus] | Deployment-controlled for SDK; not an automatic E2EE guarantee. [T1][tl-sync]                                             | Paid private files/SSO; deployment options contract-dependent. [E2][er-price]                                           |
| AI generation (cloud / API key)                     | Preset cloud AI, 10 requests/day; BYOK documented for Plus. [X3][ex-ai]                          | Cloud AI; optional BYOK advertised. [X2][ex-plus], [X3][ex-ai]                                             | Agent starter kit uses configured model-provider API keys. Hosted AI coverage U. [T3][tl-agent]                           | Cloud generation and metered API; agent syntax-render path differs from prompt generation. [E3][er-agents]              |
| Agent integration (MCP / WebMCP)                    | Official Plus comparison lists MCP beta; free-product scope U. [X2][ex-plus]                     | Official MCP public beta. [X2][ex-plus]                                                                    | Typed SDK agent operations; official MCP/WebMCP offering U. [T3][tl-agent]                                                | Official MCP and skill; OAuth recommended, reduced output without API key documented. [E3][er-agents]                   |
| Shape/icon library breadth and official cloud icons | General/freehand shapes, community libraries; official cloud completeness U. [X1][ex-repo]       | Same editor plus libraries; official cloud completeness U. [X2][ex-plus]                                   | Generic/custom SDK shapes; complete official cloud set U. [T4][tl-home]                                                   | 3,000+ technical icons advertised; official-provider completeness U. [E2][er-price]                                     |
| Templates                                           | Reusable community libraries; full workflow gallery U. [X1][ex-repo]                             | Libraries/collections; gallery coverage U. [X2][ex-plus]                                                   | SDK starter kits; architecture template gallery U. [T3][tl-agent]                                                         | Examples, AI templates and presets. [E1][er-home]                                                                       |
| Export formats                                      | PNG/SVG/JSON. [X1][ex-repo]                                                                      | PNG/SVG/JSON; PDF/PPTX listed, entitlement should be checked. [X2][ex-plus]                                | SDK image/SVG exports; app formats depend on host. [T5][tl-ai]                                                            | PNG/SVG/PDF/Markdown, Visio/draw.io/BPMN and PPTX/Slides, type/plan dependent. [E4][er-export]                          |
| Embeds and integrations                             | React package, maintainer-linked VS Code extension; third-party integrations vary. [X1][ex-repo] | Embed/read-only links and REST API beta. [X2][ex-plus]                                                     | Embeddable React SDK, custom integrations; named native workflow apps U. [T4][tl-home]                                    | Confluence, Notion, VS Code, GitHub; embeds/API. Jira U here. [E6][er-integrations], [E4][er-export]                    |
| Presentation mode                                   | U for feature parity with Plus                                                                   | Slides and live presentations advertised. [X2][ex-plus]                                                    | U for packaged presentation feature                                                                                       | P: exports to editable slides; in-app presenter mode U. [E4][er-export]                                                 |
| i18n                                                | UI localization supported; current count U. [X1][ex-repo]                                        | Underlying editor localized; Plus dashboard coverage U. [X1][ex-repo]                                      | SDK documents 49 UI languages incl. RTL. [T6][tl-i18n]                                                                    | U                                                                                                                       |
| Pricing model                                       | Free MIT core. [X1][ex-repo]                                                                     | $6/user/month displayed on comparison; billing toggle qualification needed. [X2][ex-plus]                  | Hosted whiteboard distinct from SDK; production SDK commercial annual licence, quote, trial/hobby options. [T2][tl-price] | Free; Starter $15, Business $45/member/month annual; API usage extra, enterprise quote. [E2][er-price], [E3][er-agents] |

### Matrix C: architecture models and diagrams as code

For D2 / Terrastruct, verified current facts concern **D2** unless explicitly stated. The Terrastruct
root and terms URLs redirected to D2 during this review. Search-indexed older terms still describe D2 Studio; current Studio
availability, paid pricing, collaboration and hosting are **UNVERIFIED**, not declared discontinued.
[D2 home][d2-home], [Terrastruct root][terra-root], [Studio terms][terra-terms].

| Feature                                             | IcePanel                                                                                                           | Structurizr                                                                                                                                           | Ilograph                                                                                                                   | Mermaid / mermaid.live                                                                                                                       | D2 / Terrastruct                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Live traffic/flow simulation                        | P: authored message sequences, not verified load engine. [I2][ice-flows]                                           | P: dynamic views/animation, traffic simulation U. [S1][str-home]                                                                                      | P: sequences/walkthroughs, traffic engine U. [G1][ilo-features]                                                            | P: diagram rendering/animations, traffic engine U. [R1][mm-guide]                                                                            | P: animated diagrams, traffic engine U. [Q1][d2-home]                                                                         |
| Capacity planning                                   | U                                                                                                                  | U                                                                                                                                                     | U                                                                                                                          | U                                                                                                                                            | U                                                                                                                             |
| Architecture or best-practice checks                | P: MCP/AI can reason about ADRs; deterministic fix engine U. [I3][ice-mcp]                                         | Inspections for model/documentation quality, not broker sizing. [S2][str-inspect]                                                                     | U                                                                                                                          | P: syntax checking; semantic checks U. [R1][mm-guide]                                                                                        | P: language compilation; semantic architecture checks U. [Q1][d2-home]                                                        |
| Infrastructure-as-code or cloud import              | U for continuous discovery/native IaC import                                                                       | P: Java component discovery; cloud inventory U. [S1][str-home]                                                                                        | Diagram imports, not verified cloud/IaC discovery. [G1][ilo-features]                                                      | U                                                                                                                                            | U                                                                                                                             |
| Diagram-as-code                                     | P: model exports/API; canonical text authoring U. [I1][ice-price]                                                  | Core workflow: DSL and code model. [S1][str-home]                                                                                                     | Core workflow: model-based text + autocomplete. [G1][ilo-features]                                                         | Core text syntax/live preview. [R1][mm-guide]                                                                                                | Core declarative language/CLI/imports. [Q1][d2-home]                                                                          |
| C4 or multi-level views                             | Core C4 model, shared objects, domains, drafts. [I1][ice-price]                                                    | Core C4 views of one model. [S1][str-home]                                                                                                            | Nested resources and multiple perspectives; not identical to a prescribed C4 workflow. [G1][ilo-features]                  | P: C4 syntax explicitly experimental, not shared cross-diagram repository. [R2][mm-c4]                                                       | C4 themes, shared model/views, layers and links. [Q2][d2-c4]                                                                  |
| Real-time collaboration                             | Collaborative model; exact simultaneous editing semantics U. [I1][ice-price]                                       | P: server/API/locking workflows; simultaneous canvas co-edit U. [S1][str-home]                                                                        | Team collaboration; simultaneous cursor semantics U. [G2][ilo-price]                                                       | U in OSS live editor; share/edit links are asynchronous. [R3][mm-repo]                                                                       | Git/text workflow; Studio multiplayer U. [Q1][d2-home]                                                                        |
| Comments and version history                        | Viewer comments/model history. [I1][ice-price]                                                                     | Workspace versions/branches; comment workflow U for current server. [S1][str-home]                                                                    | History verified, comments U. [G1][ilo-features], [G2][ilo-price]                                                          | Browser-only editing history; Git possible outside editor. [R1][mm-guide]                                                                    | Git for text; in-product comments/history U. [Q1][d2-home]                                                                    |
| Offline / local-first / no account                  | Hosted/account; offline U. [I1][ice-price]                                                                         | Local author/view/export workflow; server optional. [S1][str-home]                                                                                    | Desktop explicitly offline/local files; online uses cloud workspace. [G2][ilo-price]                                       | No-account live editor/local history; offline via local rendering/self-host setup, not a hosted PWA guarantee. [R1][mm-guide], [R3][mm-repo] | Offline CLI, no service account for local text rendering. [Q1][d2-home]                                                       |
| Self-host                                           | Single-tenant enterprise is not proof of on-prem; U. [I1][ice-price]                                               | Yes, current local/server; older on-prem receives no more updates. [S1][str-home], [S3][str-legacy]                                                   | Desktop/on-prem and exported HTML; web team server self-host U. [G2][ilo-price]                                            | Yes: OSS library/live-editor Docker. [R3][mm-repo]                                                                                           | Local CLI/open source; hosted Studio self-host U. [Q1][d2-home]                                                               |
| Privacy controls                                    | Protected links, SSO, enterprise residency/customer keys. [I1][ice-price]                                          | Server authentication/RBAC and workspace sharing. [S1][str-home]                                                                                      | Local files, private workspaces/password links. [G1][ilo-features], [G2][ilo-price]                                        | Local rendering possible; hosted export actions can call remote renderers. Not an unconditional zero-network claim. [R3][mm-repo]            | Local CLI possible; remote icons/fonts must be accounted for. Hosted Studio policy separate. [Q1][d2-home], [Q3][terra-terms] |
| AI generation (cloud / API key)                     | Cloud AI/model options advertised; external MCP client model separate. [I4][ice-ai-release]                        | AI/LLM can generate DSL; local MCP itself need not be an LLM service. [S4][str-mcp]                                                                   | U                                                                                                                          | External LLM can write syntax; built-in OSS live-editor AI U. Mermaid Chart is separate. [R3][mm-repo]                                       | External LLM can write D2; built-in current generator U. [Q1][d2-home]                                                        |
| Agent integration (MCP / WebMCP)                    | Official paid MCP reads model/flows and writes objects/connections/ADRs; diagram-create unsupported. [I3][ice-mcp] | Official MCP with DSL and optional server operations. [S4][str-mcp]                                                                                   | U                                                                                                                          | Official OSS editor MCP U; do not attribute third-party servers to core                                                                      | Official current MCP/WebMCP U                                                                                                 |
| Shape/icon library breadth and official cloud icons | AWS/Azure/GCP/Kubernetes technology icons, custom icons. [I1][ice-price]                                           | C4 notation, cloud themes/examples; full official icon coverage U. [S1][str-home]                                                                     | Built-in AWS/Azure/GCP/developer icons, paid custom icons. [G1][ilo-features]                                              | Diagram-type notation; cloud architecture/icon registration possible, complete catalog U. [R4][mm-architecture]                              | General/sequence/class/C4 shapes; bring image/icon URLs. [Q1][d2-home], [Q2][d2-c4]                                           |
| Templates                                           | C4 model is primary; broad gallery U                                                                               | Cookbook/pattern catalog. [S1][str-home]                                                                                                              | Public architecture examples. [G3][ilo-home]                                                                               | Live-editor sample diagrams. [R1][mm-guide]                                                                                                  | Examples/themes/C4 guidance. [Q1][d2-home], [Q2][d2-c4]                                                                       |
| Export formats                                      | PNG/PDF/JSON/CSV/HTML/LLMs.txt, scoped exports by plan. [I1][ice-price]                                            | Static site, PNG/SVG, PlantUML/Mermaid and other text outputs. [S1][str-home]                                                                         | Self-contained interactive HTML; other formats U here. [G1][ilo-features]                                                  | SVG/PNG/Markdown/source; renderer choice matters. [R1][mm-guide], [R3][mm-repo]                                                              | SVG/PNG/PDF/PPTX/GIF/ASCII. [Q1][d2-home]                                                                                     |
| Embeds and integrations                             | Integration catalog/MCP; exact named native app coverage U. [I1][ice-price], [I3][ice-mcp]                         | iframe/static/image publishing; Git-based authoring. Native named app coverage U. [S1][str-home]                                                      | Native Confluence Cloud, HTML hosting, Git local files, export API. [G2][ilo-price]                                        | GitHub Markdown support; community VS Code/wiki integrations distinguish host/plugin. [R5][mm-integrations], [R6][gh-mermaid]                | Official VS Code/Vim; linked PDFs and static outputs. Other named apps U. [Q1][d2-home], [Q2][d2-c4]                          |
| Presentation mode                                   | Step-through flows and overlays. [I2][ice-flows]                                                                   | Diagram viewer/animation; not traffic playback. [S1][str-home]                                                                                        | Guided walkthroughs. [G1][ilo-features]                                                                                    | Rendered diagrams; slide presenter U                                                                                                         | P: scenarios/steps and animated/slides exports. [Q4][d2-boards], [Q1][d2-home]                                                |
| i18n                                                | U                                                                                                                  | U for UI coverage                                                                                                                                     | U                                                                                                                          | Unicode diagram text not evidence of localized editor UI; U                                                                                  | Multilingual authored text; UI localization U. [Q1][d2-home]                                                                  |
| Pricing model                                       | Free limited model; Growth $40/editor/month annual, Scale $80, Enterprise quote. [I1][ice-price]                   | Prebuilt server licence starts £300/month for 1–20 unique annual users, billed annually; local/source route distinct. [S5][str-price], [S1][str-home] | Free online; paid Pro/Team/Desktop; Confluence priced by team size. Exact toggle-derived numeric prices U. [G2][ilo-price] | Free OSS/live editor; paid Mermaid Chart is outside this column. [R3][mm-repo]                                                               | D2 open source; current Terrastruct Studio commercial terms/prices U. [Q1][d2-home], [Q3][terra-terms]                        |

### Matrix D: cloud inventory, infrastructure design and enterprise drawing

**Cloudcraft has two contexts.** The current landing page promotes Cloudcraft in Datadog as free and
lists more providers than the standalone pricing page. The latter still lists paid AWS/Azure blueprint
plans. Preserve this distinction; do not quote the old Pro seat price as the price of the Datadog
experience. [Current landing][cc-home], [standalone pricing][cc-price], [Datadog product][cc-datadog].

| Feature                                             | Cloudcraft                                                                                                                                           | Hava.io                                                                                                                                 | Brainboard                                                                                                        | Microsoft Visio                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Live traffic/flow simulation                        | P: live infrastructure/observability view; hypothetical traffic engine U. [C1][cc-home]                                                              | P: live inventory diagrams, not verified traffic engine. [H1][hava-home]                                                                | P: deploy/plan/drift, traffic engine U. [B1][brain-home]                                                          | U for built-in distributed-traffic engine                                                                                          |
| Capacity planning                                   | P: cloud cost budgeting, not throughput model. [C2][cc-price]                                                                                        | P: existing-configuration cost forecasts, not queue sizing. [H1][hava-home]                                                             | P: Infracost estimation; throughput planning U. [B1][brain-home]                                                  | U                                                                                                                                  |
| Architecture or best-practice checks                | P: security/observability context; one-click architecture fixes U. [C1][cc-home]                                                                     | P: security/configuration visibility; semantic fix engine U. [H1][hava-home]                                                            | Checkov/tfsec/Terrascan/OPA integrations for IaC security/policy. [B1][brain-home]                                | P: structured process validation in desktop Professional, not broker semantics. [V2][vis-validation]                               |
| Infrastructure-as-code or cloud import              | Cloud account scan; Datadog view expands provider list. [C1][cc-home], [C2][cc-price]                                                                | AWS/Azure/GCP inventory; Terraform integration manages Hava resources, not arbitrary HCL-to-model proof. [H1][hava-home], [H3][hava-tf] | Terraform/OpenTofu resources, Terraform import; paid cloud import AWS/Azure. [B2][brain-price], [B3][brain-docs]  | P: data connectivity/AutoCAD; native live cloud discovery U. [V1][vis-price]                                                       |
| Diagram-as-code                                     | API available; architecture DSL U. [C2][cc-price]                                                                                                    | API/JSON; concise source-authoring DSL U. [H1][hava-home]                                                                               | Visual Terraform generation and Git workflow. [B1][brain-home]                                                    | P: programmable shapes/data; concise architecture DSL U. [V1][vis-price]                                                           |
| C4 or multi-level views                             | P: cloud architecture views; C4 app model U. [C1][cc-home]                                                                                           | Filtered infra/security/container views; C4 app model U. [H1][hava-home]                                                                | P: cloud resources/projects; C4 shared views U. [B2][brain-price]                                                 | P: containers/layers/hyperlinks; semantic C4 repository U. [V1][vis-price]                                                         |
| Real-time collaboration                             | Collaboration advertised in standalone paid plans; simultaneous semantics U. [C2][cc-price]                                                          | Team access; simultaneous editable canvas U. [H2][hava-price]                                                                           | Collaborative infrastructure authoring; exact simultaneous semantics U. [B3][brain-docs]                          | Web real-time collaboration. [V1][vis-price]                                                                                       |
| Comments and version history                        | Standalone blueprint history, retention plan-dependent; comments U. [C2][cc-price]                                                                   | Automatic versions, retention by plan; comments U. [H2][hava-price]                                                                     | Native versions/Git; comments U here. [B2][brain-price]                                                           | Commenting; OneDrive/SharePoint version storage workflow. [V1][vis-price], [V3][vis-history]                                       |
| Offline / local-first / no account                  | Account/cloud workflow; offline U. [C2][cc-price]                                                                                                    | Connected inventory/account workflow; offline U. [H2][hava-price]                                                                       | Cloud deployment workflow; no-account/offline U. [B3][brain-docs]                                                 | Plan 2 desktop offline/local files; licensed activation still required. [V1][vis-price], [V4][vis-deploy]                          |
| Self-host                                           | U                                                                                                                                                    | Isolated enterprise self-host available, quote. [H2][hava-price]                                                                        | Enterprise self-host/single tenant and private runner; scope/cost contractual. [B2][brain-price]                  | Local desktop is not self-hosted Visio web SaaS. Web self-host U. [V1][vis-price]                                                  |
| Privacy controls                                    | Private shared links, 2FA, enterprise SSO in standalone. [C2][cc-price]                                                                              | Data control through isolated deployment. [H2][hava-price]                                                                              | RBAC/Git, SSO/audit/private deployment on enterprise. [B2][brain-price]                                           | Microsoft 365 sharing/security; local desktop files. [V1][vis-price]                                                               |
| AI generation (cloud / API key)                     | U for standalone diagram generator                                                                                                                   | U                                                                                                                                       | Built-in AI advertised; deployment/data-flow and customer-key requirements U. [B1][brain-home]                    | Built-in native prompt-to-Visio/Copilot generation U; external tooling is separate                                                 |
| Agent integration (MCP / WebMCP)                    | U; API alone not MCP                                                                                                                                 | U; API alone not MCP                                                                                                                    | U                                                                                                                 | Official diagram-editing MCP/WebMCP U                                                                                              |
| Shape/icon library breadth and official cloud icons | Standalone AWS/Azure; Datadog cloud inventory supports broader providers. [C2][cc-price], [C1][cc-home]                                              | Provider/resource views rather than broad freehand library. [H1][hava-home]                                                             | AWS/Azure/GCP/OCI Terraform design resources. [B2][brain-price]                                                   | Large stencil ecosystem, Azure/AWS/network/UML; Plan 2 advertises 250,000+ shapes incl. partners. [V1][vis-price]                  |
| Templates                                           | U for current gallery scope                                                                                                                          | Automatic environment layouts, template gallery U. [H1][hava-home]                                                                      | Public/private templates and modules. [B2][brain-price]                                                           | Extensive diagram templates by edition. [V1][vis-price], [V5][vis-templates]                                                       |
| Export formats                                      | Standalone PNG/PDF/SVG, cost Excel/CSV. Datadog export parity U. [C2][cc-price]                                                                      | Visio/PNG/CSV/JSON. [H1][hava-home]                                                                                                     | Terraform code; image/document export coverage U. [B1][brain-home]                                                | Native Visio, PDF and SVG/image exports; desktop/web differences. [V6][vis-export]                                                 |
| Embeds and integrations                             | Standalone embeds incl. Confluence/Jira, API; Datadog integration. [C2][cc-price], [C1][cc-home]                                                     | Embeds, CI/GitHub Actions and Terraform integration. [H1][hava-home], [H3][hava-tf]                                                     | GitHub/GitLab/Bitbucket/Azure DevOps, CI/policy tools. Native Notion/Confluence/VS Code/Jira U. [B1][brain-home]  | Teams/SharePoint/Office/Power BI; named non-Microsoft integrations U. [V1][vis-price]                                              |
| Presentation mode                                   | Diagram sharing; dedicated presenter U                                                                                                               | Interactive views/embeds; dedicated presenter U                                                                                         | U                                                                                                                 | P: PowerPoint integration; native meeting presenter workflow U. [V1][vis-price]                                                    |
| i18n                                                | U for app UI (localized docs not proof)                                                                                                              | U                                                                                                                                       | U                                                                                                                 | Multilingual Office deployment; exact Visio UI count U. [V4][vis-deploy]                                                           |
| Pricing model                                       | Datadog landing: free; standalone Free/Pro/Enterprise paid per-seat model still listed. Applicability must be checked. [C1][cc-home], [C2][cc-price] | Professional $59/month, Teams $249/month displayed; additional sources/retention; enterprise/self-host quote. [H2][hava-price]          | Free; Pro $99/user/month displayed monthly; Enterprise quote; cloud imports extra per resource. [B2][brain-price] | Basic Visio in eligible Microsoft 365 plans; Plan 1 $5, Plan 2 $15/user/month annual; perpetual editions separate. [V1][vis-price] |

### Matrix E: recently discovered direct simulation competitors

These tools were found through searches for “system design simulator,” “architecture traffic simulator”
and 2025/2026 variants, followed by official pages/repositories. **Discovery in this review is not proof
of a 2025–2026 launch.** Their launch dates remain U unless the profile gives dated first-party evidence.
All numerical fidelity claims remain U without a source audit and controlled runs. Their advertised
features still invalidate a claim that Live Diagrams alone offers executable architecture diagrams.

| Feature                                             | SysSimulator                                                                           | TinkerTools simulator                                                                     | Mutexmachine                                            | System Design Sim                                            | PRISM                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live traffic/flow simulation                        | Advertised WASM discrete-event traffic/chaos. [N1][sys-home]                           | Advertised request propagation/utilization/latency. [N2][tinker]                          | Advertised deterministic traffic/incidents. [N3][mutex] | Advertised traffic and failure playground. [N4][sds]         | Advertised live traffic/failure feedback. [N5][prism]                                                                                             |
| Capacity planning                                   | Bottlenecks/metrics and rough AWS costs. [N1][sys-home]                                | Configurable throughput/cache/database capacity. [N2][tinker]                             | Capacity/cost tradeoffs, connection pools. [N3][mutex]  | Replicas/cache/AWS instance tradeoffs. [N4][sds]             | Saturation/queue/latency feedback. [N5][prism]                                                                                                    |
| Architecture or best-practice checks                | P: bottleneck callouts; static fixes U. [N1][sys-home]                                 | P: Explain Architecture; rule/fix engine U. [N2][tinker]                                  | P: post-mortem; static fix engine U. [N3][mutex]        | P: interactive fixes/failed-component explanation. [N4][sds] | P: design scoring/AI evaluation; deterministic rules U. [N5][prism]                                                                               |
| Infrastructure-as-code or cloud import              | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Diagram-as-code                                     | P: JSON export; concise DSL U. [N1][sys-home]                                          | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| C4 or multi-level views                             | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Real-time collaboration                             | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Comments and version history                        | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Offline / local-first / no account                  | Browser/no signup; offline U. [N1][sys-home]                                           | Browser-local processing claim; offline/no-account persistence guarantees U. [N2][tinker] | Browser/free/no account; offline U. [N3][mutex]         | Browser/free/no signup; offline U. [N4][sds]                 | Sign-in offered; no-account/full offline scope U. [N5][prism]                                                                                     |
| Self-host                                           | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Privacy controls                                    | Share links store diagram server-side for seven days; no E2EE verified. [N1][sys-home] | Claims processing stays in browser; encryption/sharing controls U. [N2][tinker]           | U                                                       | U                                                            | U                                                                                                                                                 |
| AI generation (cloud / API key)                     | U                                                                                      | Explain mode is not proof of AI; U                                                        | U                                                       | U                                                            | AI evaluation advertised; provider/key/data-flow U. [N6][prism-price]                                                                             |
| Agent integration (MCP / WebMCP)                    | U: MCP-agent blueprints are simulated workloads, not proof of editor tools             | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Shape/icon library breadth and official cloud icons | 18 component types advertised; official cloud library U. [N1][sys-home]                | Generic infrastructure roles; official set U. [N2][tinker]                                | Backend roles; official set U. [N3][mutex]              | AWS components; complete official set U. [N4][sds]           | System-design components; official set U. [N5][prism]                                                                                             |
| Templates                                           | Blueprint gallery. [N1][sys-home]                                                      | Four starter architectures listed. [N2][tinker]                                           | Guided lessons/scenarios. [N3][mutex]                   | Challenges/guides. [N4][sds]                                 | Interview challenges/learning roadmap. [N5][prism]                                                                                                |
| Export formats                                      | JSON/PNG. [N1][sys-home]                                                               | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Embeds and integrations                             | Share links; native workflow apps U. [N1][sys-home]                                    | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Presentation mode                                   | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| i18n                                                | U                                                                                      | U                                                                                         | U                                                       | U                                                            | U                                                                                                                                                 |
| Pricing model                                       | Advertised free; long-term model U. [N1][sys-home]                                     | Tool pricing U                                                                            | Advertised free. [N3][mutex]                            | Advertised free. [N4][sds]                                   | Public beta through 31 Dec 2026; future paid plans. Homepage/free-usage limits conflict with pricing FAQ: confirm. [N5][prism], [N6][prism-price] |

## 3. Competitor profiles

“Relative gap” below means **the reviewed sources do not establish Live Diagrams' combined
broker-aware simulation/checks/private playback workflow**. It is not proof of feature absence.
All U cells remain open research questions, not sales claims to repeat as negatives.

### diagrams.net / draw.io

For people who need broadly compatible technical drawings without a compulsory vendor account. Its
strength is the combination of mature drawing controls, broad shapes, storage choice and integrations.
Official MCP/assistant plugins and hosted/custom AI generation make it a serious agent competitor too.
Relative gap: no verified quantitative event-driven simulation in the reviewed editor docs. Live should
coexist through draw.io interchange rather than claim a better general-purpose editor.
[Product][draw-home], [connector controls][draw-waypoints], [AI][draw-ai], [MCP][draw-mcp].

### Lucidchart

For teams standardizing professional diagrams, review and access governance. It combines shape libraries,
revision history, presentation and cloud AI/MCP. Its structured alignment/measurement tooling is a relevant
canvas benchmark. Relative gap: the reviewed material does not establish queue/broker capacity simulation;
the more immediate Live disadvantage is team workflow and purchasing familiarity. Exact current seat
prices were U in the extracted pricing page.
[Plans][luc-plans], [arrangement][luc-arrange], [presentation][luc-present], [MCP][luc-mcp].

### Lucidscale / Lucidchart Cloud Accelerator

For organizations documenting deployed cloud estates. Imported resource metadata, filtered views and
refresh are stronger than a one-time local file conversion for answering “what is deployed now?”
Lucid's August 2026 notice explicitly treats Lucidscale as legacy and points to cloud frames in
Lucidchart. Relative gap: cloud inventory is not verified hypothetical message-flow simulation. Live
should emphasize credential-free local imports and behavioural explanation, not equal discovery coverage.
[Migration and legacy scope][luc-scale], [current frames][luc-frames].

### Miro

For teams facilitating workshops and combining architecture with planning, documents and discussion.
Its template ecosystem, collaboration and integrations are major strengths; MCP now reads and writes
boards and comments. Connection controls include quick connected creation, insertion, multiple labels and
line jumps. Relative gap: a distributed traffic/capacity engine is U. Live's opportunity is a focused
engineering session and portable simulation, rather than reproducing the whole workshop platform.
[Plans][miro-price], [MCP][miro-mcp], [connections][miro-connect].

### FigJam

For design/product/engineering teams already using Figma. Quick-create connectors, multiplayer,
comments, templates, cloud shapes and Figma ecosystem access make it a credible technical whiteboard.
Current docs also describe editable Mermaid conversion and MCP, so “only generic sticky notes” would
be an unfair characterization. Relative gap: runtime broker semantics and numerical capacity planning
are U; its team collaboration is the stronger benchmark for Live.
[Plans][fig-price], [connectors and Mermaid][fig-connect], [collaboration examples][fig-collab].

### Excalidraw

For lightweight sketching, interviews and explanations. The open editor documents local-first autosave,
offline PWA use, encrypted collaboration, bound/labeled arrows and reusable libraries. That makes
no-account privacy a shared baseline rather than Live's exclusive territory. Relative gap: a semantic
architecture/simulation model is U. Live is better positioned for runnable messaging diagrams; Excalidraw
is a strong reference for low-friction sketching.
[Maintainer README][ex-repo], [AI paths][ex-ai].

### Excalidraw+

For people who want the sketching canvas with a managed team workspace, presentations and comments.
Cloud AI/BYOK, API and MCP add developer workflows. Free-room E2EE must not be generalized to all Plus
data: the AI page describes encryption at rest and in transit for Plus. Relative gap: the combined
behavioural model remains U; Live's private offline simulation export is a differentiated artifact, while
Plus has the stronger managed-workspace story.
[Comparison][ex-plus], [AI/security scope][ex-ai].

### tldraw

For whiteboarding users, and separately for developers building custom canvas products. The SDK offers
custom shapes, bindings, sync, localization and agent starter kits; commercial production licensing and
hosting are material requirements. Relative gap: it is a canvas foundation, not a documented turnkey
distributed-systems simulator. Live should benchmark its interaction primitives without treating SDK
extensibility as a finished end-user feature or assuming it is free MIT infrastructure.
[SDK][tl-home], [licensing][tl-price], [sync][tl-sync], [agents][tl-agent].

### Eraser.io

For engineers keeping diagrams and technical notes close to code. Native DSL, cloud/file ingestion,
GitHub/VS Code/Notion/Confluence workflows, collaborative review and MCP/skills make it one of the
closest competitors for an agent-assisted architecture workflow. Its docs distinguish agent-written
syntax rendering from cloud prompt generation. Relative gap: quantitative broker simulation is U;
Live trails on source-to-document workflow. Its self-hosted agent toolkit must not be described as
proof that the entire hosted editor is available on premises.
[Product][er-home], [agents][er-agents], [integrations][er-integrations], [data sources][er-data].

### IcePanel

For teams maintaining a shared C4 architecture model over time. Reused objects, model views, domains,
drafts, history and story flows are the standout strengths. Paid MCP now supports model writes; the
current docs explicitly exclude diagram creation, drafts, versions and comments from those tools.
Relative gap: authored flows are not verified load simulation. Live needs reusable views, while retaining
its faster diagram-to-scenario path and local access model.
[Plans/model features][ice-price], [Flows][ice-flows], [MCP scope][ice-mcp].

### Structurizr

For architects treating C4 models, documentation and decisions as versioned source. Its core advantage
is deriving many views from one DSL/code model, with inspections, local rendering, exports and MCP.
Current local/server products should be distinguished from legacy Lite/on-prem/cloud documentation.
Relative gap: dynamic diagrams are not verified throughput simulation; Live offers a different direct
editing experience. Structurizr explicitly says it is not a traditional UI-based diagram-authoring tool.
[Current docs][str-home], [features][str-features], [inspections][str-inspect], [MCP][str-mcp].

### Cloudcraft

For cloud infrastructure teams planning or inspecting resources with visual cost context. The Datadog
experience emphasizes observability/security-enriched infrastructure views; standalone blueprints
retain their own pricing and export/history descriptions. Relative gap: live resource data does not
establish hypothetical broker simulation. Live should not compete on real-estate discovery or operational
telemetry without building those capabilities. Current provider and plan claims must specify which
Cloudcraft experience they concern.
[Current landing][cc-home], [Datadog][cc-datadog], [standalone plans][cc-price].

### Hava.io

For cloud/platform teams that need automatically maintained inventory diagrams and historical
configuration evidence. Multi-cloud discovery, filtered views, exports, embeds and an isolated deployment
option are strengths. Relative gap: configuration/cost visibility is not verified message-load planning.
Live's one-time IaC imports serve a different job; Hava's Terraform integration should not be mistaken
for arbitrary Terraform source import.
[Product][hava-home], [deployment/pricing][hava-price], [Terraform integration][hava-tf].

### Brainboard

For platform/DevOps teams designing and deploying Terraform/OpenTofu infrastructure. Visual authoring,
generated IaC, Git/CI, drift and security-policy integrations go much further into infrastructure
delivery than Live. Enterprise self-hosting is offered under separate terms. Relative gap: hypothetical
application/broker traffic simulation is U. Live should complement this execution pipeline with
behavioural review rather than become a cloud provisioner.
[Product][brain-home], [plans][brain-price], [workflow documentation][brain-docs].

### Ilograph

For documenting complex systems through nested resources, relationships and perspectives. Autocomplete,
automatic layout, sequence views, guided walkthroughs, password links, Confluence and self-contained
HTML are substantial strengths. This is direct evidence that interactive offline diagrams are not unique
to Live. Relative gap: a rate/backlog engine and fixable capacity findings remain U. Ilograph's
on-prem offering here means Desktop/local files, not a verified self-hosted team web service.
[Features][ilo-features], [deployment and pricing][ilo-price], [public examples][ilo-home].

### Mermaid / mermaid.live

For documentation authors who want small text diagrams rendered in Markdown and developer tools.
Text source, familiar repository workflows, sample diagrams and broad host support are the strengths;
C4 syntax is explicitly experimental. mermaid.live's local history does not equal collaborative
version history, and its configurable remote export links complicate blanket “never leaves the browser”
claims. Relative gap: executable broker simulation is U. Live can complement Mermaid with richer,
inspectable and replayable architecture files. Paid Mermaid Chart is a separate product.
[Guide][mm-guide], [live-editor source][mm-repo], [C4][mm-c4], [GitHub rendering][gh-mermaid].

### D2 / Terrastruct

For engineers who prefer declarative source with layout engines, themes, composition and broad exports.
D2's C4 model/view guidance and layers are especially relevant to Live's multi-level gap. Animations and
scenario boards do not prove load simulation. Current Terrastruct Studio packaging was not verifiable;
the root and terms URLs redirected to D2, while search-indexed older terms described Studio. Do not recycle historical
SaaS prices or infer that a redirect proves discontinuation.
[D2][d2-home], [C4][d2-c4], [layers][d2-boards], [scenarios][d2-scenarios], [terms][terra-terms].

### Microsoft Visio

For organizations standardizing Office-based diagram exchange, specialist stencils and data-linked
drawings. Web collaboration and the Plan 2 desktop/local workflow address different needs. Its
process-validation rules are real, but do not establish distributed architecture checks. Relative gap:
browser-only no-account broker simulation is U. Live trails the established stencil/document ecosystem;
its native file compatibility is not equivalent to arbitrary Visio editing.
[Plans][vis-price], [validation][vis-validation], [co-authoring/history][vis-history], [exports][vis-export].

### Recent entrants and smaller simulators: watchlist

The following profiles are intentionally shorter. No customer logos, usage counters, “production-grade”
claims or performance numbers are adopted as independent evidence.

| Tool                                   | Audience, verified public claim and relative gap / uncertainty                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SysSimulator                           | Interview/architecture practice; advertises browser WASM traffic, chaos, blueprint examples and AWS cost estimates. A close conceptual competitor, not just a drawing app. Its seven-day server-stored share links differ from Live's portable private delivery. Detailed broker fidelity and launch date U. [Official product][sys-home].                                             |
| TinkerTools System Design Simulator    | Learning and bottleneck demonstrations; configurable generic components, traffic presets and Explain Architecture. Public page claims browser-local processing. Broker-specific semantics, persistent private artifacts, self-host licence and launch date U. [Official tool/guide][tinker].                                                                                           |
| Mutexmachine                           | Backend practice with traffic, capacity/cost constraints, timed incidents and post-mortems. Advertises free/no-account use. Detailed broker semantics, export/privacy options and launch date U. Page extraction was incomplete; indexed official text supports only the limited claims here. [Official page][mutex].                                                                  |
| System Design Sim                      | Interview practice through simulated AWS-oriented architectures, caches/replicas and cost tradeoffs. Official FAQ labels prices approximate and explicitly says it does not replace real load testing. Imports, agent integration and private offline playback U. Page references October 2026 price inputs; launch date U. [Official page/FAQ][sds].                                  |
| PRISM                                  | Interview practice, a design canvas, simulation feedback and AI evaluation. Pricing FAQ says public beta unlocks Pro through 31 December 2026, while homepage and FAQ describe free usage differently. Actual quotas, AI data flow and quantitative fidelity U. It is not evidence of equivalent local-private operation. [Product][prism], [pricing][prism-price].                    |
| jasoncaserta/system-design-simulator   | Maintainer describes a frontend-first React Flow canvas with steady-state mathematical load propagation, scaling and bottleneck advice. It is an experimental/reference competitor; the cited capacities are assumptions, not adopted real-world benchmarks. Licence/maintenance/launch date and full broker semantics U. [Maintainer README][caserta].                                |
| Yash Lunawat's System Design Simulator | Creator's project page explicitly labels the project **2026**, with drag/drop components, request-flow simulation and failure/scaling scenarios. It lists Node/Express/WebSockets, so browser-only cannot be assumed. Persistent private output, licence and numerical validation U. [Creator's project page][yash].                                                                   |
| ArchLeet                               | Spanish-language system-design training site with June 2026 articles and simulation positioning in indexed official text. Kafka/RabbitMQ/DLQ, later chaos and sandbox/Terraform features are described as development/roadmap, not verified shipped functionality. Live app extraction returned no usable body: availability and current delivery status U. [Official site][archleet]. |
| StreamScale, PythonAlchemist           | Author-published **13 December 2025** educational simulator: a fixed fictional streaming system with selectable services/databases and failure exercises. The page explicitly labels numerical values simplified. A useful teaching benchmark, not a verified general-purpose diagram editor or broker simulator. [Original interactive article][streamscale].                         |
| AI Dev Hub “System Design Simulator”   | Official tool page updated **28 June 2026** documents a component canvas, connections, templates and exports. The name alone does not establish executable quantitative simulation: that part is **UNVERIFIED**. [Official tool][aidevhub].                                                                                                                                            |

### General simulation tools and research frameworks, briefly

| Tool     | Who it is for / strengths                                                                                                                                                                                                                                                                                                         | Relationship to Live Diagrams                                                                                                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AnyLogic | Simulation specialists building discrete-event, agent-based or system-dynamics models. Free PLE is restricted to personal learning/classroom use; commercial editions separate. [Methods][any-methods], [editions][any-editions], [download][any-download].                                                                       | Can be used to build resource/queue/capacity experiments, but this requires authoring the relevant system model; equivalent ready-made Kafka/vendor semantics are U. Greater modelling scope is not equivalent to Live's immediate architecture editor and portable no-account workflow. This is an inference from the documented methods, not a benchmark. |
| Simul8   | Process/operations teams; visual simulation, distributions, scenario comparison and OptQuest optimization. Desktop/browser authoring, data connections, version control and live-data workflows are documented. Project/Business/Twin subscriptions; current numeric quote U. [Features][simul8-features], [plans][simul8-price]. | A serious capacity-planning alternative where a team will model the process explicitly. Visio/BPMN import is documented; native distributed-broker semantics are U. More setup is likely for this task, an inference rather than measured onboarding time. “Browser-based” here does not mean a backend-free product.                                       |
| SimGrid  | Distributed-systems researchers/developers; models distributed application execution with platform/algorithm comparisons. LGPL framework with C/C++/Python/Java interfaces and local simulation. [Project][simgrid], [introduction][simgrid-intro].                                                                               | More directly about distributed computation than generic business-process simulation, but it is a framework for building experiments, not the documented visual editor/sharing workflow Live provides. It is established prior art, not claimed as a 2025–2026 entrant.                                                                                     |

## 4. Drawing-canvas quality and editing ergonomics

**No hands-on comparative canvas testing was performed for this report.** The assessments below are
inferences from official interaction documentation, demonstrations embedded/described on those pages,
and Live's documented UX contracts/release notes. They do not establish comparative input latency,
routing success rate, undo reliability, screen-reader performance or large-document limits. No numeric
“best canvas” scores are warranted by this evidence.

| Tool / family                     | Documented editing strengths                                                                                                                                                                                                                                                            | Honest comparison / limitation of this evidence                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Diagrams                     | Connected quick-add, edge insertion/reconnection, snapping/equal-gap guides, bulk edit, selection-aware Undo, keyboard navigation, inspect-to-rename and automatic routing. [UX][ld-ux], [release notes][ld-release].                                                                   | Strong specialized interaction contract. That does not establish better polish than mature canvases; semantic cards and the inspector may be slower for arbitrary illustrations. A fresh task study is needed.          |
| draw.io                           | Manual waypoint placement, exact coordinates, route reset, orthogonal rerouting and rich shape/style configuration. [Waypoints][draw-waypoints], [whiteboard theme][draw-whiteboard].                                                                                                   | Strong precision/control benchmark. More configurable UI can demand more learning; that is an inference, not a measured usability deficit. Live should preserve simpler defaults while respecting manual routing needs. |
| Lucidchart / Lucidscale           | Lucidchart documents alignment, coordinate readouts, spacing and snapping. Cloud models add auto/manual views and metadata-driven layouts. [Arrange][luc-arrange], [cloud views][luc-scale].                                                                                            | Strong professional layout benchmark; imported cloud-view layout and freeform drawing are different tasks. No direct performance or dense-edge comparison was run.                                                      |
| Miro                              | Quick connected creation, reconnect, insert shape, multi-label connectors, orthogonal/curved paths and line jumps. [Connections][miro-connect].                                                                                                                                         | Strong fluid diagramming/workshop baseline. Its own docs note restrictions such as connector-label font/alignment controls; do not equate a broad canvas with unlimited precision.                                      |
| FigJam                            | Quick create, bound bent/curved/straight connectors, movable labels, reconnection and editable Mermaid conversion. [Connectors][fig-connect].                                                                                                                                           | Strong rapid shared-flow baseline. Figma Design's vector/prototyping capabilities must not be credited wholesale to FigJam.                                                                                             |
| Excalidraw / Plus                 | Freehand and geometric tools, bound/labeled arrows, zoom, undo and libraries; Plus adds workspace/presentation features. [README][ex-repo], [comparison][ex-plus].                                                                                                                      | Strong sketching baseline. Hand-drawn appearance is a choice, not lower quality. Official cloud catalog completeness and semantic routing are separate questions.                                                       |
| tldraw                            | Custom shapes/bindings, a programmable editor, sync and agent action primitives; SDK docs include elbow-arrow snapping. [SDK][tl-home], [agent kit][tl-agent], [snapping type][tl-elbow].                                                                                               | A serious canvas-engine benchmark; the integration team must still build architecture semantics, controls and privacy behaviour. No evidence here justifies a rewrite of Live's canvas engine.                          |
| Eraser                            | DSL/visual/AI editing, automatic diagram layout, notes adjacent to diagrams and editable slide/diagram exports. [Product][er-home], [agents][er-agents], [exports][er-export].                                                                                                          | Strong code-to-document ergonomics; not the same task as arbitrary hand layout. Source/visual round-trip behaviour needs direct testing.                                                                                |
| IcePanel / Ilograph / Structurizr | Reused model views, nested perspectives or source-derived layouts reduce manual redrawing. Ilograph documents keyboard/screen-reader navigation; Structurizr explicitly rejects UI-based model authoring. [IcePanel][ice-price], [Ilograph][ilo-features], [Structurizr][str-features]. | These can communicate large systems better through model structure, without having a “better drawing canvas.” Live's multi-level gap will not be solved only by polishing drag gestures.                                |
| Mermaid / D2                      | Fast source edits, automated layout and repeatable outputs; D2 adds layout choices/themes/composition. [Mermaid][mm-guide], [D2][d2-home], [C4 composition][d2-c4].                                                                                                                     | Strong repository authoring ergonomics; less direct placement control is a workflow tradeoff. A text tool's “live preview” is not a live simulation.                                                                    |
| Cloudcraft / Hava / Brainboard    | Inventory generation, diagram filtering or resource-to-Terraform design make large cloud-resource tasks less manual. [Cloudcraft][cc-home], [Hava][hava-home], [Brainboard][brain-docs].                                                                                                | Judge each on its intended job. Automatic discovery or deployment modelling does not prove superior freeform drawing, and Live does not currently offer equivalent infrastructure lifecycle management.                 |
| Visio                             | Broad specialized stencils, layers/containers, programmable shapes and data connections; desktop/web differ. [Plans][vis-price], [templates][vis-templates].                                                                                                                            | A breadth/precision benchmark, especially for existing Office files. Current browser and desktop ergonomics cannot be collapsed into one score.                                                                         |
| New simulators                    | Advertise drag/drop components and live diagnostic feedback. [SysSimulator][sys-home], [TinkerTools][tinker], [PRISM][prism].                                                                                                                                                           | Feature pages do not establish connector quality, keyboard consistency, history reliability or scale. Those remain U until tested.                                                                                      |

**Proposed follow-up study, not completed work:** use the same small public architecture to create and
name nodes, connect to empty space, reconnect/insert, arrange a fan-out, edit an edge label, duplicate a
selection, undo the whole change, navigate by keyboard and export. Record operation counts, misroutes,
overlaps, recovery steps and accessibility findings. For responsiveness use same-run baselines/ratios,
not absolute millisecond budgets. Test a separate dense architecture and distinguish cold startup from
editing. Follow [QUALITY.md][ld-quality]; do not publish superiority claims before this study.

## 5. Recommended positioning and top ten opportunities

### Positioning

Recommended headline: **“Draw your architecture. Run its message flows. Keep it private.”**

Recommended explanation: **“A free browser workbench for distributed and event-driven systems: import
your infrastructure files, explore capacity and failure scenarios, explain the result, and share a
private interactive file.”** This reflects the documented feature combination, with simulation
assumptions visible. It avoids promising production fidelity or live cloud discovery.
[Current product baseline][ld-readme], [limits][ld-sim], [sharing][ld-interop].

Primary audience hypothesis: engineers and architects explaining an event-driven design, reliability
reviewers exploring failures, and educators demonstrating broker behaviour. Secondary: individuals using
agents to create private architecture artifacts. This audience ranking is a recommendation; conversion,
retention, willingness to pay and market size are **UNVERIFIED**.

Use a worked demonstration as evidence: import a small public Compose/AsyncAPI example, inspect a capacity
explanation, run an outage, apply an architecture fix, replay and export password-protected Interactive
HTML. Keep numerical assumptions and unsupported import semantics visible. Compare the saved result and
lost-message counts, not screenshot beauty alone. These are proposed demo steps based on existing
capabilities, not a new validation result. [Imports][ld-imports], [checks][ld-checks], [model][ld-sim],
[sharing][ld-interop].

### Ranked opportunities

Impact and effort are engineering/product estimates, not measured ROI. **S** = a contained extension,
**M** = several coordinated surfaces, **L** = model/protocol or lifecycle work requiring staged design.
Ranks balance adoption impact, differentiation and effort; they are not a numeric scoring formula.
Every proposal should keep the default canvas simple and put controls in the existing inspector,
context menus or Share surface. [UX principles][ld-ux].

| Rank | Opportunity                                                       | Impact / effort | Smallest useful scope and completion evidence                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | A browsable gallery of runnable architecture patterns             | High / S–M      | Extend existing examples with searchable categories and annotated tradeoffs: outbox, saga, Kafka groups, fan-out and failure recovery. Each has a saved scenario and stated assumptions; prove users can find and adapt a pattern. This takes the template-discovery lesson from Miro without copying its workshop breadth. [Existing examples][ld-readme], [Miro gallery baseline][miro-price].                                                                  |
| 2    | Portable review comments and named local revisions                | High / M        | Version-addressed annotations/review bundles stored with or beside the native file; explicit merge/conflict handling. A recipient can review privately and return a bundle. This is asynchronous review, not instant SaaS comments. Verify stable element IDs and comments on deleted/changed nodes. [Collaboration benchmark][er-price], [Live files][ld-interop].                                                                                               |
| 3    | C4 context/container/component views over one model               | High / L        | Stable element identities, view-specific layout and explicit aggregation of edges. Collapse/expand without duplicating simulation capacity; trace into a detailed view. Start with two levels and show a concrete model update reflected in both. [IcePanel][ice-price], [Structurizr][str-home], [D2][d2-c4].                                                                                                                                                    |
| 4    | A concise, diffable diagram-as-code workflow                      | High / M–L      | First improve canonical JSON/CLI validation and human-readable diffs; then evaluate a small DSL or carefully scoped Mermaid sidecar. Specify what preserves simulation/check metadata and reject lossy silent round trips. Prove a Git edit and visual edit produce understandable diffs. [Existing skill][ld-readme], [Eraser][er-agents], [D2][d2-home].                                                                                                        |
| 5    | VS Code and GitHub workflows for diagrams and simulation evidence | High / M        | A VS Code custom editor/preview using local files, plus a local/CI command producing check and scenario artifacts. GitHub action publishes only explicitly selected public outputs; private artifacts stay within the chosen repository policy. No hosted model upload required. [draw.io baseline][draw-home], [Eraser integrations][er-integrations], [current skill][ld-readme].                                                                               |
| 6    | Confluence/Notion distribution with an explicit private fallback  | High / M        | First document/test supported iframe, attachment and static-preview routes, including private host-supplied content. Build a native app only where the platform's access/storage model warrants it. Prove viewer access matches host permissions; never treat a public URL embed as a private integration. [Live embeds][ld-embed], [Ilograph Confluence][ilo-price], [Eraser integrations][er-integrations].                                                     |
| 7    | Optional private co-editing and presenter-follow sessions         | High / L        | Prototype opt-in small rooms: shared document edits/cursors, local persistence and a clear network boundary. Separate session transport from simulation; one presenter controls a saved scenario/seed rather than CRDT-merging live counters. Test offline merges, duplicate IDs, delete/reconnect conflicts and Undo ownership. [Yjs providers][yjs-providers], [tldraw sync benchmark][tl-sync].                                                                |
| 8    | Calibrated, reproducible capacity experiments                     | High / L        | Expand the existing explanations into parameter sweeps and comparable saved runs, with explicit measured inputs, model revision and confidence/limitations. Consider CPU/autoscaling/HTTP behaviours only through the existing proposal gates. Verify against analytic examples and same-model baselines, not undocumented vendor “production” rates. [Current model][ld-sim], [planning][ld-plan], [autoscaling][ld-scale], [Simul8 scenarios][simul8-features]. |
| 9    | Targeted canvas polish backed by task evidence                    | Medium–High / M | Run the study above; prioritize actual failures in connecting, relabelling, routing and recovery. Add manual control only where automation fails a real task. Compare operation counts and same-run responsiveness, preserve the chrome budget. [Live UX][ld-ux], [draw.io precision][draw-waypoints], [FigJam quick-create][fig-connect].                                                                                                                        |
| 10   | More credible reusable stencils and organizational conventions    | Medium / M      | Curated official icon updates, simulation-capability labels, import mapping coverage and portable team styles/template packs. Make visual identity distinct from simulated fidelity; a branded API is not implementation of that vendor. Translation review improves existing breadth before adding more languages. [Icon provenance][ld-icons], [current i18n][ld-i18n], [network modelling][ld-network].                                                        |

### Collaboration options within the privacy constraint

“No Live Diagrams backend” is compatible with optional user-controlled transports, but **remote
collaboration is not literally infrastructure-free**. A CRDT solves concurrent document convergence;
it does not by itself add access control, encryption, good Undo or a deterministic shared simulation.
The options below are proposals, not shipped features or selected dependencies.
[Yjs architecture][yjs-home], [WebSocket provider][yjs-websocket], [WebRTC provider][yjs-webrtc].

| Option                             | Benefits                                                                     | Requirements / tradeoff                                                                                                                                                                                                                         | Recommendation                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files/review bundles and Git       | Local storage, no relay, works with current artifacts                        | Asynchronous exchange, visible conflicts, no live presence                                                                                                                                                                                      | Start here for durable review/history; do not call it real-time collaboration.                                                                                               |
| Peer-to-peer WebRTC + CRDT         | Direct peer data transport; host can stay static                             | Signalling and ICE connectivity still needed; restrictive networks may require TURN. Room authorization, metadata exposure and offline persistence require explicit design. [Provider][yjs-webrtc], [WebRTC connectivity][webrtc-connectivity]. | Prototype for small opt-in sessions. Document signalling/TURN operators and make connection failure understandable.                                                          |
| Self-hostable WebSocket CRDT relay | More predictable connectivity and host-controlled authentication/persistence | The relay is a backend operated by the user/organization. Standard y-websocket is not automatically E2EE; plaintext-aware authorization differs from opaque encrypted relay design. [Provider][yjs-websocket].                                  | Most credible organizational option: static client plus optional separately deployed relay. Define encryption and authorization before recommending it for private diagrams. |
| Managed relay, explicit opt-in     | Low operational burden                                                       | External service sees at least metadata; cost, persistence and privacy depend on contract and implementation                                                                                                                                    | Evaluate only after requirements; not a prerequisite for local editing and never silently enabled.                                                                           |

Keep Private diagrams network-disabled by default. Any future “allow this private session” choice needs
an explicit scope and an equivalent self-host option; it must not weaken today's meaning of Private.
Persist encrypted artifacts locally where appropriate, keep room keys out of server logs, expire session
capabilities, and distinguish revoking future access from deleting copies already received. These are
design requirements to investigate, not security guarantees inferred from choosing a CRDT.
[Current Private contract][ld-ux], [WebRTC provider documentation][yjs-webrtc].

### Rejected or deferred directions

- **“Only live architecture diagram” / “only private AI diagram editor.”** Rejected: direct simulators,
  encrypted collaboration, local tools and official MCP offerings already exist. Claim the specific
  combination and demonstrate it. [Simulator evidence][sys-home], [Excalidraw][ex-repo],
  [draw.io agents][draw-mcp].
- **Rebuild a general whiteboard or replace the canvas engine now.** Deferred: no hands-on evidence in
  this report supports that cost. tldraw is a licensed integration foundation, not a drop-in finished
  architecture product. [SDK/licensing][tl-price], [Live UX][ld-ux].
- **Require accounts, a managed relay or cloud AI to reach basic functionality.** Rejected as a
  positioning choice inconsistent with Live's local/private contract; optional explicit services can
  be evaluated separately. [Current contract][ld-readme], [privacy controls][ld-ux].
- **Become a cloud scanner, deployment platform or billing authority.** Deferred: discovery credentials,
  synchronization, lifecycle and pricing accuracy form a much larger job. Hava/Brainboard/Cloudcraft
  already focus there; improve local imports and behavioural evidence first. [Hava][hava-home],
  [Brainboard][brain-home], [Cloudcraft][cc-home].
- **Ship a broad new DSL or perfect multi-format round trip immediately.** Deferred: start with versioned
  files, stable IDs and explicit loss reports; simulation metadata is richer than generic shapes.
  [Current interchange][ld-interop], [file/model proposals][ld-plan].
- **Treat vendor marketing metrics, untested model rates or roadmap items as proof.** Rejected: evidence
  quality must remain visible, including for Live's own planned work. Numerical calibration and new
  HTTP/autoscaling semantics need separate validation and the documented gates. [Model][ld-sim],
  [routing proposal][ld-routing], [autoscaling proposal][ld-scale].

## 6. Verification gaps and refresh checklist

The matrix deliberately leaves U cells instead of converting missing documentation into a negative.
Highest-value follow-ups are:

1. Hands-on canvas/task testing and simulator source/model audits; no comparative speed/fidelity ranking
   can be drawn from this review.
2. Lucidscale/cloud-frame entitlement and exact pricing; Cloudcraft standalone versus Datadog packaging;
   current Terrastruct Studio availability. These products have transition or extraction issues.
3. PRISM free quotas and post-beta prices; current ArchLeet delivery status; launch dates for new tools.
4. Exact UI localization and native integration coverage where marked U. Authored Unicode text,
   translated websites and generic iframes do not establish those features.
5. Scope of private hosting, encryption and AI data flows for each commercial offering. Enterprise
   single tenancy, a self-hosted agent wrapper and a local viewer are different products.

**Source handling:** all external references below are first-party product, maintainer or platform
documentation, checked on 14 October 2026. Official indexed text supplemented incomplete bodies for
Mutexmachine, ArchLeet, AnyLogic editions and older Terrastruct terms; dynamic prices/checkmark entitlements were kept U where
not recoverable. Exact links identify the evidence so a later reader can re-check changes. The Live
baseline uses repository documentation at the commit above; older research plans are labelled as plans.

### Official source index

Reference labels are grouped by product; matrix cells link directly to their supporting page. Access
date applies to the whole index. No third-party comparison article is used as evidence of a feature.

#### Live Diagrams

[ld-readme]: ../../README.md
[ld-release]: ../RELEASE-NOTES.md
[ld-sim]: ../SIMULATION.md
[ld-checks]: architecture-checks.md
[ld-interop]: ../INTEROP.md
[ld-embed]: ../EMBEDDING.md
[ld-host]: ../SELF-HOSTING.md
[ld-ux]: ../UX-PRINCIPLES.md
[ld-quality]: ../QUALITY.md
[ld-icons]: ../ICONS.md
[ld-i18n]: ../I18N.md
[ld-local-ai]: on-device-model.md
[ld-ai]: ai-diagrams.md
[ld-imports]: imports.md
[ld-plan]: planning-model.md
[ld-scale]: autoscaling.md
[ld-routing]: routing.md
[ld-network]: network-infrastructure.md

Current source anchors: [README][ld-readme], [release notes][ld-release], [simulation][ld-sim],
[checks as built][ld-checks], [interchange][ld-interop], [embeds][ld-embed], [hosting][ld-host],
[UX][ld-ux], [quality][ld-quality], [icons][ld-icons], [i18n][ld-i18n], [on-device AI][ld-local-ai],
[agents research][ld-ai], [import research][ld-imports], [planning proposal][ld-plan],
[autoscaling proposal][ld-scale], [routing proposal][ld-routing], [network research][ld-network].

#### General diagramming and whiteboards

[draw-home]: https://www.drawio.com/
[draw-mcp]: https://www.drawio.com/docs/manual/generate/drawio-mcp-server/
[draw-generation]: https://www.drawio.com/docs/reference/diagram-generation/
[draw-consistency]: https://www.drawio.com/docs/best-practice/consistent-diagrams/
[draw-cloud-icons]: https://www.drawio.com/blog/gcp-aws-shapes-network-diagrams/
[draw-whiteboard]: https://www.drawio.com/docs/tutorials/complex-diagrams-whiteboard/
[draw-docker]: https://github.com/jgraph/docker-drawio
[draw-ai-privacy]: https://www.drawio.com/trust/privacy-ai-assistants/
[draw-ai]: https://www.drawio.com/blog/updated-generate/
[draw-languages]: https://www.drawio.com/docs/reference/supported-url-parameters/
[draw-atlassian]: https://www.drawio.com/docs/integrations/atlassian/
[draw-waypoints]: https://www.drawio.com/docs/manual/connectors/waypoints-connectors/
[luc-plans]: https://help.lucid.co/hc/en-us/articles/360056903132-Lucid-Plans
[luc-mcp]: https://help.lucid.co/hc/en-us/articles/42578801807508-Integrate-Lucid-with-AI-tools-using-the-Lucid-MCP-server
[luc-scale]: https://community.lucid.co/product-questions-3/welcome-to-lucidscale-legacy-experience-13864
[luc-frames]: https://help.lucid.co/hc/en-us/articles/49028445463060-Use-cloud-frames-to-visualize-cloud-infrastructure-in-Lucidchart
[luc-export]: https://help.lucid.co/hc/en-us/articles/16324571257492-Export-or-print-a-Lucid-document
[luc-integrations]: https://lucid.co/marketplace
[luc-price]: https://lucid.app/pricing/lucidchart
[luc-present]: https://help.lucid.co/hc/en-us/articles/15994195704596-Create-a-presentation-in-Lucid
[luc-arrange]: https://help.lucid.co/hc/en-us/articles/14589107304468-Organize-and-arrange-objects
[miro-price]: https://miro.com/pricing/
[miro-mcp]: https://help.miro.com/hc/en-us/articles/31624028247058-Miro-MCP-Server-overview
[miro-diagrams]: https://miro.com/diagramming/
[miro-languages]: https://help.miro.com/hc/en-us/articles/4957762934802-Language-settings
[miro-history]: https://help.miro.com/hc/en-us/articles/360021668819-Board-history-versions
[miro-connect]: https://help.miro.com/hc/en-us/articles/360017730733-Connection-lines
[fig-price]: https://www.figma.com/pricing/
[fig-connect]: https://help.figma.com/hc/en-us/articles/1500004414542-Create-diagrams-and-flows-with-connectors-in-FigJam
[fig-rtl]: https://help.figma.com/hc/en-us/articles/4972283635863-Add-right-to-left-text
[fig-collab]: https://www.figma.com/best-practices/collaborating-in-figjam/

- draw.io: [product/storage/integrations][draw-home], [MCP][draw-mcp], [generation][draw-generation],
  [shape conventions][draw-consistency], [cloud libraries][draw-cloud-icons], [whiteboard][draw-whiteboard],
  [Docker][draw-docker], [AI privacy][draw-ai-privacy], [Generate, August 2026][draw-ai],
  [languages][draw-languages], [Atlassian][draw-atlassian], [waypoints][draw-waypoints].
- Lucid: [plans][luc-plans], [MCP, updated October 2026][luc-mcp], [Lucidscale migration][luc-scale],
  [cloud frames][luc-frames], [exports][luc-export], [marketplace][luc-integrations],
  [dynamic pricing][luc-price], [presentation][luc-present], [alignment/snapping][luc-arrange].
- Miro: [plans][miro-price], [MCP][miro-mcp], [diagram library][miro-diagrams],
  [UI languages][miro-languages], [history][miro-history], [connector interactions][miro-connect].
- Figma/FigJam: [plans/seats/features][fig-price], [connectors/Mermaid][fig-connect],
  [RTL content][fig-rtl], [collaboration examples][fig-collab].

#### Sketching and developer tools

[ex-repo]: https://github.com/excalidraw/excalidraw
[ex-plus]: https://plus.excalidraw.com/excalidraw-plus-vs-excalidraw
[ex-ai]: https://plus.excalidraw.com/ai
[tl-home]: https://tldraw.dev/
[tl-sync]: https://tldraw.dev/docs/sync
[tl-persistence]: https://tldraw.dev/docs/persistence
[tl-price]: https://tldraw.dev/pricing
[tl-agent]: https://tldraw.dev/starter-kits/agent
[tl-ai]: https://tldraw.dev/docs/ai
[tl-i18n]: https://tldraw.dev/sdk-features/internationalization
[tl-elbow]: https://tldraw.dev/reference/tlschema/ElbowArrowSnap
[er-home]: https://www.eraser.io/
[er-price]: https://www.eraser.io/pricing
[er-agents]: https://docs.eraser.io/using-ai-agent-integrations
[er-export]: https://docs.eraser.io/export
[er-data]: https://docs.eraser.io/data-sources
[er-integrations]: https://www.eraser.io/product/integrations

- Excalidraw: [maintainer README][ex-repo], [Free/Plus comparison][ex-plus], [AI and MCP scope][ex-ai].
- tldraw: [SDK][tl-home], [sync/hosting][tl-sync], [licensing][tl-price], [agent kit][tl-agent],
  [AI/programmatic exports][tl-ai], [local persistence][tl-persistence], [UI i18n][tl-i18n], [arrow snapping][tl-elbow].
- Eraser: [product][er-home], [plans][er-price], [agent integrations][er-agents], [exports][er-export],
  [data sources][er-data], [workflow integrations][er-integrations].

#### Models and diagrams as code

[ice-price]: https://icepanel.io/pricing
[ice-flows]: https://docs.icepanel.io/visual-storytelling/flows
[ice-mcp]: https://docs.icepanel.io/integrations/mcp-server
[ice-ai-release]: https://feedback.icepanel.io/changelog/v108-mcp-read-write
[str-home]: https://docs.structurizr.com/
[str-features]: https://docs.structurizr.com/features
[str-inspect]: https://docs.structurizr.com/workspaces/inspections
[str-legacy]: https://docs.structurizr.com/onpremises/usage
[str-mcp]: https://docs.structurizr.com/ai/mcp
[str-price]: https://docs.structurizr.com/server/pricing
[ilo-home]: https://www.ilograph.com/
[ilo-features]: https://www.ilograph.com/features.html
[ilo-price]: https://www.ilograph.com/pricing.html
[mm-guide]: https://mermaid.js.org/intro/getting-started.html
[mm-repo]: https://github.com/mermaid-js/mermaid-live-editor
[mm-c4]: https://mermaid.js.org/syntax/c4.html
[mm-architecture]: https://mermaid.js.org/syntax/architecture.html
[mm-integrations]: https://mermaid.js.org/ecosystem/integrations-community.html
[gh-mermaid]: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams
[d2-home]: https://www.d2lang.com/
[d2-c4]: https://www.d2lang.com/blog/c4/
[d2-boards]: https://d2lang.com/tour/layers/
[d2-scenarios]: https://d2lang.com/tour/scenarios/
[terra-root]: https://terrastruct.com/
[terra-terms]: https://terrastruct.com/terms-and-conditions/

- IcePanel: [plans/model/history/exports][ice-price], [authored flows][ice-flows], [MCP scope][ice-mcp],
  [AI/MCP release][ice-ai-release].
- Structurizr: [current product docs][str-home], [authoring philosophy][str-features],
  [inspections][str-inspect], [legacy on-prem notice][str-legacy], [MCP][str-mcp], [server pricing][str-price].
- Ilograph: [overview/examples][ilo-home], [editing/sharing][ilo-features], [deployment/plans][ilo-price].
- Mermaid: [live-editor guide][mm-guide], [deployment/remote renderers][mm-repo], [experimental C4][mm-c4],
  [architecture syntax][mm-architecture], [community integrations][mm-integrations],
  [GitHub platform rendering][gh-mermaid].
- D2/Terrastruct: [D2 features][d2-home], [C4 model/views][d2-c4], [layers][d2-boards],
  [scenarios][d2-scenarios], [root redirect][terra-root], [terms URL / indexed older terms][terra-terms].

#### Infrastructure and Visio

[cc-home]: https://www.cloudcraft.co/
[cc-price]: https://www.cloudcraft.co/pricing
[cc-datadog]: https://www.datadoghq.com/product/cloudcraft/
[hava-home]: https://www.hava.io/
[hava-price]: https://www.hava.io/pricing
[hava-tf]: https://docs.hava.io/integrations/terraform
[brain-home]: https://www.brainboard.co/
[brain-price]: https://www.brainboard.co/pricing
[brain-docs]: https://docs.brainboard.co/
[vis-price]: https://www.microsoft.com/en-us/microsoft-365/visio/visio-plans-and-pricing
[vis-validation]: https://support.microsoft.com/en-au/visio/validate-a-structured-diagram
[vis-history]: https://support.microsoft.com/en-us/visio/work-together-on-visio-drawings
[vis-deploy]: https://learn.microsoft.com/microsoft-365-apps/deploy/deployment-guide-for-visio
[vis-templates]: https://support.microsoft.com/en-gb/visio/featured-visio-templates-and-diagrams
[vis-export]: https://support.microsoft.com/en-gb/visio/save-a-visio-diagram-as-a-graphic-or-image-file

- Cloudcraft: [current Datadog landing][cc-home], [standalone plans][cc-price], [Datadog product][cc-datadog].
- Hava: [features/discovery/exports][hava-home], [pricing/self-host][hava-price], [Terraform][hava-tf].
- Brainboard: [design/deploy/policy][brain-home], [plans/import fees][brain-price], [workflow][brain-docs].
- Visio: [plans and desktop/web differences][vis-price], [process validation][vis-validation],
  [co-authoring/history][vis-history], [deployment/licences][vis-deploy], [templates][vis-templates],
  [exports][vis-export].

#### Simulators and collaboration foundations

[sys-home]: https://syssimulator.com/
[tinker]: https://tinkertools.app/tools/system-design-simulator
[mutex]: https://www.mutexmachine.com/
[sds]: https://systemdesignsim.com/
[prism]: https://www.prismhld.com/
[prism-price]: https://www.prismhld.com/pricing
[caserta]: https://github.com/jasoncaserta/system-design-simulator
[yash]: https://www.yashlunawat.com/projects/system-design-simulator
[archleet]: https://www.archleet.com/
[streamscale]: https://www.pythonalchemist.com/blog/system-design-database-simulator
[aidevhub]: https://aidevhub.io/system-design-simulator/
[any-methods]: https://www.anylogic.com/blog/the-big-book-of-simulation-modeling-new-chapters-part-3/
[any-editions]: https://www.anylogic.help/anylogic/ui/editions.html
[any-download]: https://www.anylogic.com/downloads/
[simul8-features]: https://www.simul8.com/software/
[simul8-price]: https://www.simul8.com/software/pricing
[simgrid]: https://simgrid.org/index.html
[simgrid-intro]: https://simgrid.org/doc/latest/Introduction.html
[yjs-home]: https://docs.yjs.dev/
[yjs-providers]: https://docs.yjs.dev/getting-started/a-collaborative-editor
[yjs-websocket]: https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
[yjs-webrtc]: https://github.com/yjs/y-webrtc
[webrtc-connectivity]: https://webrtc.org/getting-started/peer-connections

- Direct simulators: [SysSimulator][sys-home], [TinkerTools][tinker], [Mutexmachine][mutex],
  [System Design Sim][sds], [PRISM][prism], [PRISM pricing conflict][prism-price].
- Additional first-party leads: [Caserta README][caserta], [Lunawat 2026 project][yash],
  [ArchLeet roadmap][archleet], [StreamScale 2025 article][streamscale], [AI Dev Hub 2026 tool][aidevhub].
- General simulation: [AnyLogic methods][any-methods], [editions/restricted PLE][any-editions],
  [download][any-download], [Simul8 features][simul8-features], [Simul8 plans][simul8-price],
  [SimGrid][simgrid], [SimGrid introduction][simgrid-intro].
- Collaboration design evidence: [Yjs][yjs-home], [provider choices][yjs-providers],
  [self-hostable WebSocket][yjs-websocket], [WebRTC connector][yjs-webrtc],
  [WebRTC connectivity/STUN/TURN][webrtc-connectivity].
