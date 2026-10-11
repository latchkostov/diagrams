# AI-buildable diagrams: research and plan

Status: research, 2026-10-11. Scope: let people and AI agents build and refine Diagrams by description, with no backend.
Numbers in brackets like [3] point to the sources at the end. Third-party claims are marked; WebMCP and the Prompt API change month to month, so re-check anything marked "verify" before relying on it.

---

## 1. Findings

### 1.1 WebMCP today

**Spec status.** WebMCP is a _Draft Community Group Report_ of the W3C Web Machine Learning CG, latest dated 9 Oct 2026. Its editors are from Microsoft and Google. It is not on the W3C Standards Track [1].

**API shape (current draft) [1][2][7]**

```webidl
partial interface Document { [SecureContext] readonly attribute ModelContext modelContext; };
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional { sequence<USVString> exposedTo; AbortSignal signal; });
  Promise<sequence<RegisteredTool>> getTools(optional { sequence<USVString> fromOrigins; });   // agent/extension side
  Promise<DOMString> executeTool(tool, object input, optional { AbortSignal signal; });        // agent/extension side
  attribute EventHandler ontoolchange, ontoolactivated, ontoolcancel;
};
dictionary ModelContextTool {
  required DOMString name;        // 1–128 chars of [A-Za-z0-9_.-]
  USVString title;
  required DOMString description;
  object inputSchema;             // JSON Schema
  required ToolExecuteCallback execute;  // (input, { signal }) => Promise<any>
  ToolAnnotations annotations;    // readOnlyHint, untrustedContentHint, consequentialHint, debugging (all default false)
};
```

- **Where it lives.** The entry point is now **`document.modelContext`**. `navigator.modelContext` was deprecated in Chrome 150 and survives only as an alias that logs a warning [7][8]. Feature-detect with `document.modelContext ?? navigator.modelContext`.
- **What's gone.** `provideContext()` and `clearContext()` from the February draft were removed (issue #101, PR #132) after a security flaw. Removal now works by aborting the `signal` you passed to `registerTool`. Registering a name that's already taken throws [7].
- **What `execute` returns.** The explainer's example returns an MCP-style `{ content: [{ type: "text", text }] }`, and `executeTool` hands the agent a string [1][2]. _Verify against ChatGPT, the only shipping consumer; see the risks section._
- **Permissions.** A Permissions Policy feature called `tools` gates the API, with default allowlist `'self'`. Cross-origin iframes therefore need `allow="tools"`, and a site can opt out entirely with `Permissions-Policy: tools=()` [1][3].
- **Declarative API.** You can annotate a `<form>` with `toolname`, `tooldescription` and `toolautosubmit` [6]. It isn't in the spec text yet, and it's irrelevant to a canvas app.
- **No in-page user-confirmation API yet.** "A way for a tool to prompt the user for confirmation" is still an open question (#165, #50) [2]. The `consequentialHint` annotation is the signal that clients use to ask the user before acting [1].
- **Chrome's size guidance.** Keep descriptions to about 500 characters, parameter descriptions to about 150, names to about 30, and tool output to about 1.5K characters [6][7]. These are guidance, not spec limits.

**Who implements it (as of early Oct 2026)**

| Browser or agent                                                | Status                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome                                                          | Testing flag `chrome://flags/#enable-webmcp-testing` [3]. Origin trial from Chrome 149 through 156, which ends around 16–17 Nov 2026. Chrome 157 is the _anticipated_, uncommitted ship milestone [3][9][11].                                                                                                |
| Edge                                                            | Origin trial; Microsoft said it was "ready for testing" on 21 Sep 2026, and the trial runs to 17 Nov 2026 [9, third-party].                                                                                                                                                                                  |
| Firefox / Safari                                                | Mozilla is neutral and not implementing. WebKit is opposed [9].                                                                                                                                                                                                                                              |
| **ChatGPT desktop app (built-in browser), ChatGPT Work, Codex** | **Works today.** "Site tools" have been on by default since 25–27 Aug 2026, on GPT-5.6 Sol and Terra only, and not in Enterprise or Edu. An address-bar indicator shows whether a tool reads or changes data, and ChatGPT confirms sensitive actions [10][9]. It does not work "in Chrome via ChatGPT" [10]. |
| Gemini in Chrome                                                | Announced at I/O in May 2026 ("will soon support WebMCP APIs") [5]. Not usable yet [9].                                                                                                                                                                                                                      |
| Claude in Chrome                                                | **No support.** It reads pages, not their tools. Feature request #76809 is open [9][11].                                                                                                                                                                                                                     |
| Frameworks                                                      | Stagehand and Vercel agent-browser work. Puppeteer and Chrome DevTools MCP need a flag. Playwright: not planned [9].                                                                                                                                                                                         |

**Polyfills and bridges.** MCP-B (`@mcp-b/global`, `@mcp-b/webmcp-polyfill`) installs a `document.modelContext` polyfill only when there's no native one. It adds MCP-B extras such as resources, prompts and `outputSchema`, and it is "not an official W3C or MCP project" [12]. A polyfill only _offers_ tools: an agent still needs the MCP-B extension or a similar bridge to _call_ them [9]. **Don't bundle it.** Native registration behind feature detection reaches every real consumer (ChatGPT, origin-trial Chrome and Edge, Stagehand and others) at zero bundle cost.

**Discovery.** There's no manifest or remote discovery: an agent has to _visit_ the page, and tools exist only while that page is open and visible. They're tied to the document, so they disappear on navigation, and there's no headless use [3][10]. Chrome's advice is to register only the tools that make sense in the current UI state and to remove them when they stop applying [4].

**Chrome's tool-design guidance [4]**

- One job per tool, with no overlapping tools.
- Use verbs that say whether a tool acts immediately.
- Descriptions should say what the tool does and when to use it, phrased positively.
- Accept raw user input (for example, "1,000 orders/s") rather than making the model convert it.
- Validate strictly in code, keep the schema loose, and return descriptive errors so the model can retry.
- Update the UI after each call so the agent can see the result.
- Develop against evals.

**Security [1].** The main threats are:

- tool poisoning through descriptions
- **prompt injection through tool output**: our labels and notes are user-authored, and shared links come from other people
- a tool's declared intent not matching what it actually does

The spec's mitigations are input-length limits, `untrustedContentHint` on outputs and `consequentialHint` on risky actions.

### 1.2 Built-in browser AI (Prompt API)

- **Chrome.** The Prompt API (`LanguageModel`, Gemini Nano) has been **stable for web pages since Chrome 148** (May 2026). It's desktop only: Windows, macOS 13+, Linux and Chromebook Plus. There's no Android or iOS support [5][13][15].
  - **Hardware.** It needs 22 GB free on the profile volume and either a GPU with more than 4 GB VRAM or 16 GB RAM with 4+ cores. The download needs an unmetered connection, and the model is evicted if free space drops below 10 GB [13].
  - **Download.** The model downloads per device the first time a site uses it. `create()` needs a user activation while a download is pending. Use `monitor` to show `downloadprogress` [13].
  - **Languages.** en, ja, es, de and fr [13].
- **Structured output.** Pass `responseConstraint` as a JSON Schema object (or a RegExp) to `prompt()`.
  - Unsupported schema features throw `NotSupportedError`, and output the model can't make fit throws `SyntaxError` [14].
  - The schema counts against context unless you set `omitResponseConstraintInput: true`, in which case the prompt itself should describe the format [13][14].
  - Avoid hard length limits in schemas, because the model starts compressing text oddly to meet them [15].
- **Tool calling.** The explainer has an "open loop" design (`tools` in `create()`, with the model returning `LanguageModelToolCall` and the page replying with `LanguageModelToolSuccess` or `LanguageModelToolError`). It is only **experimental, behind a flag** (`chrome://flags/#prompt-api-tool-use`) in Chrome and Edge [3][14]. **Don't depend on it**: use `responseConstraint` instead.
- **Context.** Read `session.contextWindow` and `session.contextUsage`, and estimate with `measureContextUsage()`. On overflow the oldest turns are dropped while `initialPrompts` are kept (a `contextoverflow` event fires), and if even that isn't enough you get `QuotaExceededError` [13][14]. Older measurements put the budget at about **6K tokens** per session [16, third-party, Chrome 137–138; measure at runtime]. Use `clone()` to fork a primed session cheaply [13].
- **Edge.** Phi-4-mini is a developer preview (Windows and macOS 13.3+, 20 GB disk, 5.5 GB VRAM). There's a newer "Aion-1.0-Instruct" in Canary and Dev 150+ [17]. Google's guidance lists Edge stable as unsupported [15].
- **Safari.** **WebKit formally opposes the Prompt API** (27 May 2026), citing no consent for inference, interop drift across models, and fingerprinting [18]. **Firefox:** no implementation found.

**Realistic quality for our task.** Gemini Nano is a small model; one third-party estimate puts it at about 4–6B parameters [16].

- **It's good at:** turning a paragraph into a short, schema-constrained list of entities and relations.
- **It's weak at:** multi-step planning, keeping ids consistent across a long context, picking from 155 stencil ids, and anything that needs coordinates.

**How to make it accurate.** Give it as little to decide as possible:

1. **Model output is mentions, not diagram JSON.** For example, `{ op: "add_node", kind: ".NET consumer", label: "billing-worker" }`. _Our_ resolver maps `kind` to `service.dotnet`, mints ids, places nodes and validates. The model never sees stencil ids unless the current diagram has them.
2. **Use a flat constrained schema.** One op object type with an `op` enum and optional fields, because Chrome's subset may reject `oneOf` [14]. Cap the number of ops at about 20 per turn in code, not in the schema.
3. **Few-shot.** Put a system prompt and 3 short examples in `initialPrompts` (create once, then `clone()` per turn). Include an "edit existing" example that refers to elements by label.
4. **Keep context small.** Each turn is a fresh clone that gets `describe_diagram` text (truncated to about 1.5K tokens) plus the request. Don't keep a growing chat history.
5. **Validate, then repair once.** Dry-run the ops. On an error (an unknown reference, or an ambiguous label with its candidates), send one repair prompt with the error text. If it still fails, apply the valid prefix only if the user agrees; otherwise show the error.
6. **Run simulations as a separate prompt** with their own small schema, triggered only when the request mentions load or failure ("/s", "per second", "goes down", "spike", "burst", "fails").

### 1.3 External agents and MCP

| Path                                                 | Works for                                                                                                                                 | Verdict                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote MCP connector (Claude.ai, ChatGPT Apps)       | Claude web, ChatGPT (remote only [24, third-party])                                                                                       | **No**: needs a server.                                                                                                                                                                                                                     |
| **Local stdio MCP server as an npm package**         | Claude Desktop (manual config or `.mcpb` bundle [23]), Claude Code, Codex CLI, Cursor, VS Code. Not ChatGPT, which doesn't do stdio [24]. | **Sensible.** There's direct precedent: `npx @drawio/mcp` runs locally and opens diagrams in the web editor by deflating and base64-encoding the XML into the URL hash [20]. Ours would do exactly that with `#d=`. No backend and no cost. |
| WebMCP via browsing agent                            | ChatGPT desktop browser and Work today; Chrome/Edge agents later                                                                          | **Yes**, behind feature detection.                                                                                                                                                                                                          |
| DOM driving (Claude in Chrome, Gemini, computer use) | Everyone else                                                                                                                             | Already works somewhat. These agents read the **accessibility tree and screenshots**, not `data-testid`, so the accessible names on toolbar buttons, palette items and inspector fields matter more than test ids.                          |

- **MCP Apps** (`ui://` HTML resources rendered in a sandboxed iframe in Claude and ChatGPT; official since Jan 2026 [25]) could later let the npm server show a live, interactive diagram inline in chat by embedding our `/embed` viewer. Treat it as optional and later.
- **`llms.txt` and a JSON Schema.** **Yes, cheap.** Evidence that agents actually _read_ `llms.txt` is weak: adoption reports are vendor claims [26]. Even so, a stable `https://www.livediagrams.dev/schema/diagram.v1.json` plus a generated `stencils.json` are what an agent writing a `.diagram.json`, the npm package and the "paste from your chatbot" flow all need. The cost is a build step that emits static files into `public/`.

### 1.4 How others do it

- **tldraw agent kit [19].** The model emits a stream of _typed actions_ (`_type` plus a Zod schema), applied as each one completes. Each action has a `sanitizeAction()` step: make sure an id exists and is unique, coerce numbers, round coordinates. The model works with **simple ids** mapped to internal ones, and perceives the canvas as structured shape summaries plus a screenshot plus "lints".
- **draw.io [20].** The LLM writes a _whole_ document (XML, CSV or Mermaid), validated against an XSD, with a format reference injected into the tool descriptions. The MCP server opens the result through a URL-hash link.
- **Eraser DiagramGPT [21].** It classifies the diagram type, then generates its own diagram-as-code DSL.
- **Excalidraw community MCP servers [22].** Most expose `create_element(type, x, y, …)`, so the LLM does the geometry. Variants that "own spatial reasoning" let the model deal only in nodes and edges.
- **Takeaway for us.**
  - Whole-document generation suits one-shot creation from scratch, but it's poor at _incremental_ refinement and makes the model handle ids and coordinates.
  - Semantic ops plus a compact read tool are better for iteration, small models, undo, and showing what changed. That's what tldraw converged on.
  - The model never supplies coordinates.

---

## 2. Recommended architecture

```
                 ┌──────────────── src/ai/  (pure TS, no DOM, no React) ────────────────┐
 WebMCP tools ─┐ │ ops.ts       applyOps(diagram, ops, opts) -> { diagram, results, errors }│
 Describe panel├─┤ refs.ts      resolveRef("billing-worker" | id | "A -> B" | key)           │
 Paste-from-AI ┤ │ stencils.ts  resolveKind(".NET consumer") -> { id, label, confidence, alts }│
 npm MCP pkg  ─┘ │ describe.ts  describeDiagram(diagram, { format, focus, limit })           │
                 │ simulate.ts  buildSimulation(diagram, spec) -> Simulation (+ autoScale)    │
                 │ place.ts     placeNew(diagram, newIds, mode)  (layeredLayout / placeNextTo)│
                 │ schemas.ts   JSON Schemas below (also emitted to public/schema/)         │
                 └───────────────────────────────────────────────────────────────────────────┘
 Every path ends in validateDiagram() (src/interop/native.ts), then ONE EditorApi call: applyDiagram(next, { merge: "ai:<callId>" })
```

**Key decisions**

1. **One core, four front-ends.** The ops layer is a pure function over `DiagramFile`. It reuses:
   - `searchStencils`/`STENCIL_ALIASES` and `inferStencil` for resolution
   - `palette/fuzzy.ts` for label matching
   - `uniqueId`/`stencilIdBase` for ids
   - `layeredLayout` and `placeNextTo`/`placeFree` for placement
   - `autoScale`, `simulationProblem` and `simulationReferenceWarnings` for simulations

   Because none of it touches the DOM, the same code runs in the app, in vitest, and in Node for the npm package.

2. **Ops, not whole diagrams; atomic batches.** `edit_diagram` takes an array of ops and applies all of them or none, so one call is one undo step. Agents are told to batch a whole request into one call.
3. **References.** Any element can be named in these ways, tried in this order:
   1. an exact id
   2. a `key` set earlier in the same batch
   3. an exact label, case- and whitespace-insensitive
   4. `"label (sublabel)"`
   5. a unique fuzzy match on label or sublabel

   Edges are named `"From -> To"`. If a reference is ambiguous or unknown, the batch fails with `candidates: [{ id, label, stencil }]`. Results always return the real ids, and the tool descriptions say to prefer ids once they're known.

4. **Stencil resolution belongs to us, and we report it back.** The pipeline tries, in order:
   1. an exact stencil id
   2. `searchStencils` on `kind` (aliases cover ".NET", "pg", "sb" and so on)
   3. `inferStencil(kind, label)`
   4. `generic.service` with `confidence: "low"`

   Every `add_node` result includes `stencil: { id, label, confidence, alternatives[3] }`, so the model, or the user in the panel, can fix it with `update { kind: "<id>" }`. Context bias, such as preferring Azure stencils when the diagram already uses Azure, can come later.

5. **Layout.** The model never sends x and y. After a batch, placement depends on `layout`:
   - **`"auto"`** (the default). If the diagram was empty, or at least half its nodes are new, run `layeredLayout` over everything. Otherwise place each new node with `placeNextTo` its first connected existing neighbour along `direction` (default LR), falling back to `placeFree`. Then call `fitGroupToContents` on any touched boundary.
   - **`"full"`** forces a full re-layout.
   - **`"none"`** places new nodes in free space only.
6. **Undo.** Add `EditorApi.applyDiagram(next, { merge })`. It replaces the diagram in one state update and **flushes history immediately**: today history is debounced at 350 ms and coalesces by tag, so an explicit commit stops an AI change from merging with a user drag.
   - _In the app:_ one AI turn is one undo step.
   - _WebMCP and npm:_ one `edit_diagram` or `set_simulation` call is one step.
   - After applying, show a toast such as "AI: +3 nodes, +2 connections · Undo" and briefly highlight what changed.
7. **Preview.** Apply immediately, then offer Undo, with no modal preview (simple by default). The exceptions:
   - `dryRun: true` lets agents check a batch first.
   - In the Describe panel, a batch that **removes** more than 3 elements, or replaces the diagram, shows a one-line confirm first.
   - `new_diagram` is marked `consequentialHint`, so ChatGPT asks the user.
8. **Untrusted content.** `describe_diagram` and the `edit_diagram` results echo user-authored text, so they carry `untrustedContentHint: true`.
   - Labels are always quoted in describe output and are never interpolated into instructions.
   - Tool inputs go through the same `validateDiagram` limits as files.
   - Tools are registered **only in the editor**, not in `/embed` or the gallery.
9. **WebMCP lifecycle.** A `useWebMcp(editor)` hook does three things:
   - It feature-detects, then registers the tools inside a `useEffect` with an `AbortController`, awaiting each `registerTool` and catching duplicate-name errors (StrictMode mounts effects twice).
   - It aborts on unmount and when switching to live view. In live view it registers only `describe_diagram`, `get_share_link` and (phase 2) `play_simulation`.
   - It wraps every `execute` in one adapter that returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }`, so the return format can be switched in one place.

   The origin-trial token goes in `index.html` as `<meta http-equiv="origin-trial" content="…">`.

10. **Tests.** A Playwright init script installs a fake `document.modelContext` that records `registerTool` calls, so e2e tests can call the tools directly. All selectors use `data-testid`. Unit tests cover the ops, refs, resolver and describe code, plus an **eval corpus** of about 30 descriptions with their expected graphs (nodes, stencils and edges), run against every front-end.

---

## 3. Phased plan

**Phase 1: ships fast and is useful with no model at all (about 1–1.5 weeks)**

1. `src/ai/` core: ops, refs, stencil resolver, describe, placement and schemas, with unit tests and the eval corpus as fixtures.
2. `EditorApi.applyDiagram` with an immediate history commit, the change toast with Undo, and the change highlight.
3. **"Build with AI" dialog** (command palette entry and toolbar), which works everywhere, including Safari and Firefox:
   - **Copy prompt** puts the current `describe_diagram` text, the op schema and 2 examples on the clipboard. The user pastes it into ChatGPT, Claude or Gemini with their own request.
   - **Paste reply** takes the chatbot's ops JSON (or a `diagrams/v1` file with no coordinates) and runs it through the same validation, repair hints and apply path.
   - This is the model-independent path, and it exercises the whole core.
4. **WebMCP registration** with feature detection: `describe_diagram`, `find_stencils`, `edit_diagram`, `set_simulation`, `new_diagram`, `get_share_link`. Add the Chrome and Edge origin-trial tokens.
5. **Static agent docs:** `public/llms.txt`, plus `public/schema/diagram.v1.json`, `public/schema/ops.v1.json` and `public/schema/stencils.json`, generated at build from `catalog.ts` and the aliases.
6. A Describe-panel shell that renders **only** when `"LanguageModel" in self` and `availability()` isn't `"unavailable"`. In phase 1 it may simply be hidden: no dead UI.
7. An accessibility pass so DOM-driving agents can find things: accessible names on the toolbar, palette search, palette items and inspector fields.

**Phase 2: in-app on-device model, gated by evals (about 1 week, after phase 1 proves the ops)**

- Describe panel on the Prompt API:
  - `create()` on first open (a user gesture), with download progress shown, then `clone()` per turn
  - a flat ops schema as `responseConstraint`, a separate simulation prompt, and one repair retry
  - "Generated on this device" wording
- Ship it only if the eval corpus scores at least 80% exact-structure on Nano. Otherwise keep it behind a "Labs" toggle.
- Add the `play_simulation` WebMCP tool, and stencil context bias.

**Phase 3: npm MCP package `@livediagrams/mcp` (about 3–5 days)**

- A stdio server built from the same `src/ai/` core, bundled with esbuild and holding one in-memory diagram per session.
- It has the same tools, except that `get_share_link` returns a `https://www.livediagrams.dev/#d=…` URL. It adds `open_in_browser`, `save_diagram(path)` and `load_diagram(path | share URL)`.
- Warn when a link exceeds `SHARE_WARN_LENGTH` (8,000) and suggest saving a file instead.
- Later: an `.mcpb` bundle for one-click Claude Desktop install, and MCP Apps inline rendering through `/embed`.

**Recommendations**

| Item                                                                 | When                                                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ops core, paste-from-chatbot, WebMCP, schemas and llms.txt           | **Now** (phase 1)                                                                                                                                                                       |
| In-app Prompt API panel                                              | **Later** (phase 2), gated by evals. It covers Chrome desktop on capable hardware only, WebKit opposes it, and Nano is small. It's nice to have, not core.                              |
| npm MCP package                                                      | **Next** (phase 3). It's the _only_ accurate path for Claude users today, because Claude in Chrome lacks WebMCP. It's cheap once the core is pure, and draw.io shows the pattern works. |
| Remote MCP server, MCP-B polyfill bundling, declarative WebMCP forms | **Never**, or not applicable.                                                                                                                                                           |

---

## 4. Tool list with JSON Schemas

These tool names and schemas are shared by WebMCP, the npm MCP server and the paste flow. `Ref` is described in the decisions above. All schemas use JSON Schema draft 2020-12.

Shared definitions (`$defs`, inlined into each tool at build time):

```json
{
  "Ref": {
    "type": "string",
    "minLength": 1,
    "maxLength": 200,
    "description": "An element: id from describe_diagram (preferred), a key set earlier in this call, an exact label, 'label (sublabel)', or for a connection 'From -> To'."
  },
  "NodeProps": {
    "type": "object",
    "additionalProperties": true,
    "description": "Simulation settings. Unknown keys are kept.",
    "properties": {
      "ratePerSec": { "type": "number", "minimum": 0, "description": "Sources: messages per second." },
      "latencyMs": { "type": "number", "minimum": 0 },
      "concurrency": {
        "type": "integer",
        "minimum": 1,
        "description": "Processors: messages handled at once per replica."
      },
      "replicas": { "type": "integer", "minimum": 1 },
      "partitions": { "type": "integer", "minimum": 1, "description": "Topics/streams." },
      "failureRate": { "type": "number", "minimum": 0, "maximum": 1 },
      "maxDeliveryCount": { "type": "integer", "minimum": 1 },
      "retry": { "type": "string", "enum": ["requeue", "inplace"] },
      "messageType": { "type": "string" },
      "emits": { "type": "string", "description": "Message type this node emits downstream." }
    }
  },
  "Tone": { "type": "string", "enum": ["azure", "aws", "gcp", "k8s", "onprem", "neutral"] }
}
```

### 4.1 `describe_diagram` (readOnlyHint, untrustedContentHint)

Description: "Read the current diagram as compact text: nodes with ids, kinds and labels, connections, boundaries and simulations. Call before editing an existing diagram."

```json
{
  "type": "object",
  "properties": {
    "format": { "type": "string", "enum": ["text", "json"], "default": "text" },
    "focus": {
      "type": "array",
      "items": { "$ref": "#/$defs/Ref" },
      "maxItems": 20,
      "description": "Only these elements and their direct neighbours."
    },
    "limit": { "type": "integer", "minimum": 10, "maximum": 500, "default": 150, "description": "Max lines." }
  }
}
```

Text output example (labels are always quoted):

```
Diagram "Orders" · direction LR · 4 nodes, 3 connections, 1 boundary, 1 simulation
nodes:
  orders-api      service.dotnet (.NET Service)  "orders-api"  replicas=2  in g1
  orders-created  kafka.topic (Kafka Topic)      "Kafka" / "orders.created"  partitions=6
  billing-worker  service.dotnet (.NET Service)  "billing-worker"
  billing-db      postgres (PostgreSQL)          "billing-db"
connections:
  e1 orders-api -> orders-created  async "OrderCreated"
  e2 orders-created -> billing-worker  async
  e3 billing-worker -> billing-db  sync
boundaries: g1 "Azure" (azure): orders-api
simulations: sim1 "Peak" — 1000/s from orders-api for 60s; at 10s billing-db down
```

### 4.2 `find_stencils` (readOnlyHint)

Description: "Search the stencil catalog (Kafka, Azure, AWS, GCP, databases, services…). Use when edit_diagram reported low confidence for a kind."

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "Free text, e.g. '.NET consumer', 'service bus queue'."
    },
    "category": {
      "type": "string",
      "enum": ["messaging", "compute", "data", "network", "observability", "security", "clients", "generic"]
    },
    "limit": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 }
  }
}
```

Returns `[{ id, label, vendor, category, simRole, description }]`.

### 4.3 `edit_diagram` (untrustedContentHint on output)

Description: "Add, connect, change or remove diagram elements in one atomic step (one undo). Describe kinds in plain words ('.NET consumer', 'Kafka topic'); the app picks the icon and position. Put a whole request in one call."

```json
{
  "type": "object",
  "required": ["ops"],
  "properties": {
    "ops": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "oneOf": [
          {
            "type": "object",
            "required": ["op", "kind", "label"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "add_node" },
              "kind": {
                "type": "string",
                "maxLength": 100,
                "description": "Plain words or a stencil id, e.g. 'Kafka topic', 'service.dotnet'."
              },
              "label": { "type": "string", "maxLength": 200 },
              "sublabel": {
                "type": "string",
                "maxLength": 200,
                "description": "Second line, e.g. a topic name 'orders.created'."
              },
              "key": {
                "type": "string",
                "maxLength": 50,
                "description": "Name to refer to this node later in the same call."
              },
              "in": { "$ref": "#/$defs/Ref", "description": "Boundary to place it in." },
              "props": { "$ref": "#/$defs/NodeProps" }
            }
          },
          {
            "type": "object",
            "required": ["op", "from", "to"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "connect" },
              "from": { "$ref": "#/$defs/Ref" },
              "to": { "$ref": "#/$defs/Ref" },
              "label": { "type": "string", "maxLength": 200 },
              "kind": {
                "type": "string",
                "enum": ["async", "sync"],
                "default": "async",
                "description": "async = messages/events; sync = request/response, writes to a database."
              }
            }
          },
          {
            "type": "object",
            "required": ["op", "target"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "update" },
              "target": { "$ref": "#/$defs/Ref" },
              "label": { "type": "string", "maxLength": 200 },
              "sublabel": { "type": ["string", "null"], "maxLength": 200 },
              "kind": {
                "type": "string",
                "maxLength": 100,
                "description": "Nodes: change the stencil. Connections: 'async' or 'sync'."
              },
              "in": {
                "type": ["string", "null"],
                "description": "Move into this boundary; null removes it from its boundary."
              },
              "props": { "$ref": "#/$defs/NodeProps", "description": "Merged; a null value deletes the key." }
            }
          },
          {
            "type": "object",
            "required": ["op", "targets"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "remove" },
              "targets": {
                "type": "array",
                "minItems": 1,
                "maxItems": 100,
                "items": { "$ref": "#/$defs/Ref" },
                "description": "Nodes, connections ('A -> B'), boundaries (contents are kept) or notes."
              }
            }
          },
          {
            "type": "object",
            "required": ["op", "label", "members"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "add_boundary" },
              "label": { "type": "string", "maxLength": 200 },
              "members": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/Ref" } },
              "tone": { "$ref": "#/$defs/Tone" },
              "key": { "type": "string", "maxLength": 50 }
            }
          },
          {
            "type": "object",
            "required": ["op", "text"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "add_note" },
              "text": { "type": "string", "maxLength": 2000 },
              "style": { "type": "string", "enum": ["note", "text"], "default": "note" },
              "near": { "$ref": "#/$defs/Ref" }
            }
          },
          {
            "type": "object",
            "required": ["op"],
            "additionalProperties": false,
            "properties": {
              "op": { "const": "set_meta" },
              "title": { "type": "string", "maxLength": 200 },
              "description": { "type": "string", "maxLength": 2000 },
              "direction": { "type": "string", "enum": ["LR", "TB"] }
            }
          }
        ]
      }
    },
    "layout": { "type": "string", "enum": ["auto", "full", "none"], "default": "auto" },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "Validate and report without changing the diagram."
    }
  }
}
```

Success result (keep it under about 1.5K characters, summarising long batches):

```json
{
  "ok": true,
  "summary": "+3 nodes, +2 connections",
  "undo": "One undo step reverts this call.",
  "results": [
    {
      "i": 0,
      "op": "add_node",
      "id": "billing-worker",
      "label": "billing-worker",
      "stencil": {
        "id": "service.dotnet",
        "label": ".NET Service",
        "confidence": "high",
        "alternatives": ["generic.service", "azure.functions"]
      }
    },
    { "i": 1, "op": "connect", "id": "e4", "from": "orders-created", "to": "billing-worker" }
  ],
  "warnings": ["'kind: Postgres writer' resolved to postgres with low confidence"]
}
```

Failure result: nothing is applied.

```json
{
  "ok": false,
  "i": 2,
  "error": "'billing' matches 2 elements.",
  "candidates": [
    { "id": "billing-worker", "label": "billing-worker", "stencil": "service.dotnet" },
    { "id": "billing-db", "label": "billing-db", "stencil": "postgres" }
  ],
  "hint": "Use an id from candidates."
}
```

**Flat variant for the Prompt API `responseConstraint`.** Use a single object type with `op: { enum: [...] }` and all the fields above optional, with no `oneOf`; per-op required fields are checked in code. The paste flow accepts either variant.

### 4.4 `set_simulation`

Description: "Create or replace a simulation in plain units: who sends how much traffic, what breaks when, and what should hold true. Times are seconds."

```json
{
  "type": "object",
  "required": ["title", "traffic"],
  "properties": {
    "title": { "type": "string", "maxLength": 200 },
    "replace": {
      "$ref": "#/$defs/Ref",
      "description": "Existing simulation id or title to overwrite; omitted = add new."
    },
    "durationSec": { "type": "number", "minimum": 1, "maximum": 3600 },
    "traffic": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "items": {
        "type": "object",
        "required": ["from", "pattern"],
        "additionalProperties": false,
        "properties": {
          "from": { "$ref": "#/$defs/Ref" },
          "pattern": { "type": "string", "enum": ["constant", "burst", "ramp", "spike"] },
          "ratePerSec": { "type": "number", "minimum": 0, "description": "constant; ramp start; spike base." },
          "toRatePerSec": { "type": "number", "minimum": 0, "description": "ramp target; spike peak." },
          "count": { "type": "integer", "minimum": 1, "description": "burst size." },
          "startSec": { "type": "number", "minimum": 0, "default": 0 },
          "durationSec": { "type": "number", "minimum": 0, "description": "constant/ramp/spike length; burst spread." },
          "peakSec": { "type": "number", "minimum": 0, "description": "spike: how long the peak lasts." },
          "messageType": { "type": "string" },
          "label": { "type": "string" }
        }
      }
    },
    "events": {
      "type": "array",
      "maxItems": 50,
      "items": {
        "type": "object",
        "required": ["atSec", "node", "do"],
        "additionalProperties": false,
        "properties": {
          "atSec": { "type": "number", "minimum": 0 },
          "node": { "$ref": "#/$defs/Ref" },
          "do": { "type": "string", "enum": ["down", "up", "pause", "slow", "set"] },
          "latencyMs": { "type": "number", "minimum": 0, "description": "for 'slow'." },
          "props": { "$ref": "#/$defs/NodeProps", "description": "for 'set'." },
          "note": { "type": "string", "maxLength": 300, "description": "Optional narration shown at this time." }
        }
      }
    },
    "expectations": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "required": ["label", "metric", "op", "value"],
        "additionalProperties": false,
        "properties": {
          "label": { "type": "string" },
          "node": { "$ref": "#/$defs/Ref", "description": "Omit with metric 'inSystem'." },
          "metric": {
            "type": "string",
            "enum": [
              "processed",
              "backlog",
              "inFlight",
              "failed",
              "deadLettered",
              "dropped",
              "throughput",
              "lag",
              "inSystem"
            ]
          },
          "op": { "type": "string", "enum": ["<", "<=", "==", ">=", ">"] },
          "value": { "type": "number" },
          "when": { "type": "string", "enum": ["always", "eventually", "end"], "default": "end" }
        }
      }
    }
  }
}
```

Mapping notes:

- Seconds become ms.
- `pattern` maps to a `TrafficShape`; for example, constant becomes `{ kind: "constant", ratePerSec, fromMs, durationMs }`, with `durationMs` defaulting to `durationSec` or 60 s.
- `down`, `up` and `pause` map to `{ do: "status" }`. `slow` maps to `{ do: "props", props: { latencyMs } }`.
- `scale` comes from `autoScale`.
- Validate with `simulationProblem` and `simulationReferenceWarnings`.

Example: "1,000 orders/s, payments goes down after 10 s" becomes `traffic: [{ from: "orders-api", pattern: "constant", ratePerSec: 1000, durationSec: 60 }]` and `events: [{ atSec: 10, node: "payments", do: "down" }]`.

### 4.5 `new_diagram` (consequentialHint)

Description: "Start a new, empty diagram. The current one stays in the library."

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string", "maxLength": 200 },
    "direction": { "type": "string", "enum": ["LR", "TB"], "default": "LR" }
  }
}
```

### 4.6 `get_share_link` (readOnlyHint)

Description: "Get a link that opens the current diagram. The diagram is stored in the link itself; nothing is uploaded."

```json
{ "type": "object", "properties": {} }
```

Returns `{ url, length, warning? }`, with a warning when `length > 8000`.

### 4.7 Phase 2 and 3 additions

- `play_simulation { simulation?: Ref }` switches to the live view and plays (phase 2, WebMCP only).
- `save_diagram { path }`, `load_diagram { source: path | share URL }` and `open_in_browser {}` (npm package only).

---

## 5. Risks and unknowns

- **WebMCP churn.** It has already changed twice (`provideContext` was removed, and `navigator` moved to `document`), and the origin trial ends around mid-Nov 2026 with shipping in Chrome 157 not committed. Mitigation: a single adapter file, plus feature detection so nothing breaks if the API disappears.
- **Return-format ambiguity.** It's unclear whether ChatGPT wants a string or `{ content: [...] }`. Test both in the ChatGPT desktop browser before release; the adapter makes the switch a one-line change.
- **Consumers.** Only ChatGPT (desktop, specific plans and models) calls WebMCP tools today. Claude in Chrome and Gemini don't yet, so the accessibility-tree path and the npm package matter for those users.
- **Prompt injection** through shared diagrams' labels flowing into agents. Mitigations: `untrustedContentHint`, quoting labels, length limits, and confirming `new_diagram` and large removals.
- **Prompt API reach and quality.** Chrome desktop only, with heavy hardware and disk requirements and a multi-GB first download, and only 5 languages; Safari opposes it. The context budget may be about 6K tokens, which forces truncated describe output. Nano's accuracy on our task is unknown until it's evaluated; hence the eval gate.
- **`responseConstraint` schema subset.** It's unknown whether `oneOf`/`const` are supported, which is why the flat variant exists.
- **History.** The debounced, observed history needs an explicit commit path for `applyDiagram`, or an AI change may merge with a user edit.
- **Layout quality** when adding to a hand-arranged diagram. Incremental `placeNextTo` must never move existing nodes; full re-layout only happens when asked or when most nodes are new. Whether `layeredLayout` handles boundaries needs checking.
- **Share-link length** for big diagrams produced by the npm package: offer saving a file.
- **Stencil ids become a public contract** once `stencils.json` is published. This is already the rule ("never rename").

## 6. What the owner needs to do

1. Register **Chrome's WebMCP origin trial** for `https://www.livediagrams.dev` (and the apex domain, if served), plus Edge's. Paste the tokens into `index.html`, note the expiry (around Nov 2026), and watch for a Chrome 157 ship decision.
2. **Manually test with the ChatGPT desktop app** (needs a plan with GPT-5.6 Sol or Terra). Agents can't do this for you.
3. Reserve the npm name (`@livediagrams/mcp` or `livediagrams-mcp`) before phase 3.
4. Give UX sign-off on the "Build with AI" dialog and the change toast (the UX review gate).
5. Nothing else: no keys, no servers, no cost.

---

## Sources

1. WebMCP specification, Draft CG Report, 9 Oct 2026. https://webmachinelearning.github.io/webmcp/
2. WebMCP explainer repo (registerTool example, open questions). https://github.com/webmachinelearning/webmcp
3. Chrome for Developers, "WebMCP" (updated 7 Oct 2026). https://developer.chrome.com/docs/ai/webmcp
4. Chrome for Developers, WebMCP best practices. https://developer.chrome.com/docs/ai/webmcp/best-practices
5. Chrome at Google I/O 2026 (Prompt API stable; WebMCP OT in 149; "Gemini in Chrome will soon support WebMCP"). https://developer.chrome.com/blog/chrome-at-io26
6. InfoQ, "WebMCP … Now Available in Chrome (Origin Trials)", 13 Jun 2026. https://www.infoq.com/news/2026/06/webmcp-web-agent-standard-chrome/
7. "WebMCP's Origin Trial: provideContext Is Already Gone" (third-party). https://dev.to/jangwook_kim_e31e7291ad98/webmcps-origin-trial-providecontext-is-already-gone-54j8
8. byteiota, "Chrome 150 deprecates navigator.modelContext", 30 Aug 2026 (third-party). https://byteiota.com/webmcp-chrome-150-navigator-modelcontext-deprecation/
9. WebMCP Ecosystem Adoption Tracker, updated 1 Oct 2026 (third-party). https://webmcp.com/ecosystem-tracker
10. Search Engine Journal, "ChatGPT Adds WebMCP Support", 27 Aug 2026. https://www.searchenginejournal.com/chatgpt-adds-webmcp-support/587237/
11. anthropics/claude-code issue #76809, WebMCP in Claude in Chrome. https://github.com/anthropics/claude-code/issues/76809
12. MCP-B npm packages (`@mcp-b/global`, `@mcp-b/webmcp-polyfill`). https://github.com/WebMCP-org/npm-packages
13. Chrome for Developers, Prompt API. https://developer.chrome.com/docs/ai/prompt-api
14. Prompt API explainer (responseConstraint, tool use, context). https://github.com/webmachinelearning/prompt-api
15. GoogleChrome modern-web-guidance, language-model guide. https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/built-in-ai/language-model.md
16. swyx, "Gemini Nano in Chrome 138: notes for AI Engineers" (third-party). https://www.swyx.io/gemini-nano
17. Microsoft Learn, Prompt API in Edge. https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api
18. WebKit standards-positions #495, Prompt API: oppose (27 May 2026). https://github.com/WebKit/standards-positions/issues/495
19. tldraw Agent starter kit. https://tldraw.dev/starter-kits/agent
20. draw.io, AI diagram generation and `@drawio/mcp`. https://www.drawio.com/docs/reference/diagram-generation/
21. Eraser DiagramGPT. https://www.eraser.io/diagramgpt
22. Community Excalidraw MCP servers, e.g. https://npmjs.com/package/excalidraw-mcp and https://glama.ai/mcp/servers/@yctimlin/mcp_excalidraw
23. Claude Help Center, local MCP servers on Claude Desktop and MCPB bundles. https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop and https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb
24. Third-party guides stating that ChatGPT MCP is remote-only (unverified against OpenAI docs). https://contextbolt.com/blog/ai-tools-mcp-support/ and https://pasqualepillitteri.it/en/news/8923/mcp-servers-connect-claude-chatgpt-gemini
25. MCP Apps (`ui://` resources, official Jan 2026). https://rits.shanghai.nyu.edu/ai/mcp-apps-interactive-uis-become-an-official-part-of-mcp
26. Presenc AI, "State of llms.txt 2026" (vendor report). https://presenc.ai/research/state-of-llms-txt-2026
