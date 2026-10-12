# On-device model (Chrome's Prompt API)

The AI panel can run requests through Chrome's built-in model (Gemini Nano, the `LanguageModel` global).
There's no key, no backend, and nothing leaves the device. This note records the API as of October 2026,
the design, and the eval gate that decides whether the request box ships on by default. Background:
[ai-diagrams.md](ai-diagrams.md), section 1.2.

## The API (checked 11 October 2026)

- **Status.** The Prompt API is **stable for web pages since Chrome 148** (5 May 2026), on by default on
  desktop. **No origin trial token is needed** for `LanguageModel` itself. The only origin trial left is
  "Sampling Parameters" (`samplingMode`, Chrome 148+), which we don't use. Chrome Extensions have had the
  API since Chrome 138. Edge ships it disabled behind a flag. Firefox has no implementation, and WebKit
  opposes it. Enterprise policies (`GenAILocalFoundationalModelSettings`, `BuiltInAIAPIsEnabled`) can turn
  it off. Official Google Chrome builds only: Chromium builds can't download the model.
- **Hardware.** Windows 10/11, macOS 13+, Linux, or ChromeOS on Chromebook Plus; no Android or iOS. At
  least 22 GB free on the profile's volume (the model is removed below 10 GB), and either a GPU with more
  than 4 GB of VRAM or 16 GB of RAM with 4+ cores. The first download (about 2.7–4 GB) needs an unmetered
  connection.
- **Shape.**
  - `LanguageModel.availability(options)` returns `"unavailable"`, `"downloadable"`, `"downloading"` or
    `"available"`. Pass the same `expectedInputs`/`expectedOutputs` (type and `languages`; en, ja, es,
    de, fr) as `create()`.
  - `LanguageModel.create({ initialPrompts, expectedInputs, expectedOutputs, signal, monitor })` makes a
    session. While the model isn't downloaded, it needs a user activation (a click or key press), and it
    starts the download. `monitor(m)` gets `downloadprogress` events with `e.loaded` from 0 to 1.
  - `initialPrompts` takes `system`, `user` and `assistant` turns (few-shot); the system prompt is never
    dropped on overflow.
  - `session.prompt(input, { signal, responseConstraint, omitResponseConstraintInput })` returns a
    string. `promptStreaming()` returns a `ReadableStream`. `responseConstraint` is a JSON Schema (or a
    RegExp), and structured output has been supported since Chrome 137.
  - `session.contextUsage` and `contextWindow` report tokens, and `measureContextUsage()` estimates them.
    Overflow fires `contextoverflow`, and a prompt too big for the window rejects with
    `QuotaExceededError`.
  - `session.clone({ signal })` forks a primed session. `session.destroy()` frees it and aborts its work.
  - Top-level windows and same-origin iframes only (cross-origin needs `allow="language-model"`); not in
    workers.

Sources: [Prompt API](https://developer.chrome.com/docs/ai/prompt-api),
[Get started with built-in AI](https://developer.chrome.com/docs/ai/get-started),
[Structured output](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api),
[New in Chrome 148](https://developer.chrome.com/blog/new-in-chrome-148),
[adsm.dev: the Prompt API is on by default](https://adsm.dev/posts/prompt-api/) (third-party).

**No action is needed for livediagrams.dev:** there's no token to register and nothing to add to
`index.html`. If a later feature needs the Sampling Parameters trial, register livediagrams.dev at
https://developer.chrome.com/origintrials, then add the token as a `<meta http-equiv="origin-trial">`
read from a `VITE_` variable, so builds without it still deploy.

## Design

- **Where.** Off by default. **Advanced ▸ Try the on-device model** turns it on (remembered), and only
  where `availability()` isn't `"unavailable"`. When it's on, a request box sits at the AI panel's foot,
  above the status line: "Describe a change…", the dictation mic, **Send** (Enter), and the label "Runs
  on this device with Chrome's built-in model". For `"downloadable"`/`"downloading"`, a one-time
  **Download the on-device model** button shows progress from `monitor`. With no `LanguageModel`, or
  `"unavailable"`, nothing shows and the how-to stays as it is.
- **Pipeline** (`src/ai/ondevice/pipeline.ts`). The model's job is kept small:
  - **Input:** a compact description of the diagram within 2,400 characters. Each node is listed by
    label (or id where labels repeat) and stencil name, then the connections; a big diagram keeps the
    selection and its neighbours first and says how much it left out. Then the selection, spelled out as
    `this = <id> "<label>"`, then the request.
  - **Output:** `responseConstraint` is a flat op object with an `op` enum (`add`, `connect`,
    `insert_between`, `rename`, `change_kind`, `remove`) and optional `key`, `kind`, `label`, `sublabel`,
    `from`, `to`, `flow` (message or request) and `target`. Kinds are plain words, new nodes have short
    keys, existing nodes are named by label, and there are no ids or coordinates. Per-op required fields
    and the 16-op cap are checked in code, not in the schema.
  - **Priming:** a system prompt with explicit direction rules, plus four worked examples (a create with
    "reads from", an edit by label, `insert_between` with `change_kind`, and "after this" with a
    selection), created once and `clone()`d per request. The examples use made-up names (Zephyr, Quill);
    a unit test checks that none of them appears in any eval request.
  - **Forgiving what a small model gets wrong** (`compactOps.ts`), each rule unit-tested:
    - **References** resolve in one precedence order, in one place (`ReplyRefs` in `src/ai/refs.ts`):
      1. an existing element's exact id;
      2. an existing element's exact label;
      3. a key the reply set;
      4. ignoring case and spaces, an existing label or a new node's key or label;
      5. a new node's kind;
      6. a word shared with exactly one new node ("Python job" for the node added as a Python service);
      7. the core's own resolution, pinned to an id.

      Anything ambiguous is an error for the retry to fix, never a silent pick: a name both an existing
      and a new node answer to, two new nodes of the same kind, or a model key that's already an
      element's id or label. Batch keys start with `~`, which no element id can, so they can't collide
      with ids made in the same batch. One reference index serves the whole reply: 5,000 nodes and
      20,000 edges convert in well under 100 ms.

    - **`insert_between` is a core op** (also in the published ops schema and llms.txt). It runs against
      the batch so far, so it sees renames and connections made earlier in the same call. It follows the
      connection if the ends are named the other way round, and fails when there isn't exactly one
      connection to replace. Both new connections keep the old one's kind, relation and props (routing:
      `filter`, `group`, `travelMs`, settings). Its label and source side go on the first new connection,
      its target side on the second. Between two nodes of one boundary, the new node joins that boundary.
      A "between" request answered with add and plain connects becomes this op. So does an
      `insert_between` with a remove of the same connection: the remove is dropped.
    - `change_kind` swaps the stencil and keeps the label and connections. A `rename` with only a kind is a
      kind change, and a `change_kind` with only a label is a rename.
    - "this" is the selected node. With "after this" (or "before this"), a connection between the
      selection and a new node drawn the wrong way round is turned (never doubled), and a new node left
      unconnected is connected from (or to) the selection.
    - **Direction:** only the pair a request describes with a consume verb ("Java consumes a Kafka topic":
      subject and object each matched to one node), and only when the consumed object is a queue, topic
      or stream. If the reply draws that one connection the wrong way round, it is turned. Other
      connections, including the rest of a mixed request ("…and forwards events to SQS"), stay as drawn.
  - **Checking:** `toOps` maps the reply onto the core's ops, and `planTurn` (`applyOps`: `resolveKind`,
    `placeNew`, validation) plans it. If either fails, the error (with candidate labels) goes back to the
    model once. A second failure shows "Couldn't apply that. Try rephrasing." and nothing is applied. A
    transient Prompt API error ("An unknown error occurred: kErrorUnknown") is first retried on a fresh
    session, without using up that retry.
  - **Committing:** the plan is made again on the diagram as it is at that moment (the person may have
    edited it meanwhile) and committed with `commitPlan`. That's one turn ("On this device · Chrome's
    built-in model") with Undo this change and Revert to here, like an agent's change.
  - **Status and cancel:** the status reads "Thinking…", "Checking and trying again…" or "Applying…".
    **Stop** (or Esc, caught before the panel's own Esc) aborts through an `AbortController`, during
    session start-up too.
  - **Context changes** (`useOnDeviceRequest`): the diagram is read only after the privacy check, and
    provenance is checked again just before inference. Going live, another diagram or a local-only
    switch cancels a request in flight. Before committing, the request checks again that it's the same
    diagram, in the editor, allowed to reach AI, and with the same content (a move meanwhile is fine). If
    the content changed, it says "The diagram changed while the model was thinking. Send it again."
  - **Dictation** uses the panel's shared `DictationField`, so it gives the same feedback as Advanced:
    "Listening…", interim words, errors and the speech-service note. Recognition runs on this device
    where the browser can (`processLocally`). Until a session confirms that, the box says "Dictation may
    use your browser's speech service (in Chrome, Google)." The app doesn't call
    `SpeechRecognition.available()` up front: it crashes Playwright's Chromium renderer, so it runs only
    when the mic starts. Going live stops dictation.
- **Live view:** v1 is editing only. In live view the box is disabled ("Back to editing to change the
  diagram"). Simulations would need their own prompt and evals.
- **Privacy:** a local-only diagram never reaches the model. The box is disabled with the panel's
  existing note, and provenance is checked again at send time.
- **Bundle:** the box, the pipeline and the session are a lazy chunk, loaded only when the box shows.
  The availability check and the setting are in the AI panel's chunk. The entry chunk is unchanged.

## Eval gate

- **Harness.** `src/ai/evals/onDevice.ts` has 37 cases: 8 edits on the Kafka example (a dead-letter
  queue after a service, rename, remove, a cache between two nodes, connect, change a kind, add an email
  sink, and a request with a selection), plus the 29 one-turn descriptions from the eval corpus, drawn
  from empty. Each case is scored on the diagram afterwards, and must be a valid diagram. The creation
  cases use `checkGraph` (`src/ai/evals/graphCheck.ts`, shared with the corpus test): expected nodes
  are matched one to one by stencil, and every expected connection must join them in the right
  direction, so reversed or misplaced connections fail. A unit test proves a perfect model scores 100% and a wrong one fails with a
  reason.
- **How to run it** (by hand, never in CI): `pnpm dev`, then open
  `http://localhost:5173/?view=lab&preset=ondevice-evals` in a desktop Google Chrome 148+ that has the
  model (check `await LanguageModel.availability()` in DevTools, or `chrome://on-device-internals`).
  Press **Run evals** (the first run may download the model), then **Copy results as Markdown** and paste
  the table below.
- **Report.** Each failed row has a **Category** (reference, direction, stencil, structure, format, model
  error) and every row has the **Model output**: the model's last reply and the stencil each added node
  resolved to. A summary line counts failures by category.
- **Bar:** at least 80% of cases pass before `ON_DEVICE_DEFAULT` (`src/ai/ondevice/onDevicePref.ts`)
  turns the box on without asking.

### Results

**Baseline, 12 October 2026, Chrome 154 (the owner's own Chrome): 20/37 passed (54%), 19 on the first
try.** Most requests took 1.5–2.5 s. The failures, and the fix each got in `feat/ondevice-accuracy`:

| Case               | Failure                                                   | Category    | Fix                                                                                                 |
| ------------------ | --------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| edit-rename        | `An unknown error occurred: kErrorUnknown`, twice         | model error | Retry once on a fresh session                                                                       |
| edit-between       | The direct connection was left in place                   | structure   | `insert_between`; a "between" request's bypassed connection is dropped                              |
| edit-change        | `rename` with a kind and no label                         | format      | `change_kind`; a kind-only `rename` is a kind change                                                |
| edit-selection     | New queue not connected to the selection                  | structure   | `this = <id> "<label>"`; "after this" connects it                                                   |
| create-4           | `Unknown reference "Python job"`                          | reference   | Same-reply references by key, label, kind and word                                                  |
| create-5, create-6 | Connection reversed ("consumes")                          | direction   | Direction rules in the prompt; the consume-verb flip                                                |
| create-9           | Missing `service.go` for "a processor"                    | stencil     | Expectation made fair (below); "a processor" resolves to a generic service                          |
| create-10          | Missing `service.python`                                  | stencil     | Unknown: the next run's Model output will show what the model wrote                                 |
| create-12          | Missing `service.go`                                      | stencil     | "Redis" alone now resolves to the cache; the Go side needs the Model output                         |
| create-15          | `Unknown reference "Container Apps"`                      | reference   | References by kind                                                                                  |
| create-18          | Missing `rabbitmq.queue`                                  | stencil     | Expectation made fair (below): bare "RabbitMQ" resolves to the exchange                             |
| create-21          | Missing `client.iot`                                      | stencil     | "IoT devices" already resolves to `client.iot`, so the model wrote something else: see Model output |
| create-23, 24, 29  | `Unknown reference "Orders API"` (and "Partner Whispers") | reference   | Example leakage: the examples now use made-up names                                                 |
| create-28          | Missing `generic.service`                                 | stencil     | Expectation made fair (below); "component" resolves to a generic service                            |

A unit test replays these failures with replies shaped like the model's mistakes, and each now passes
(`src/ai/evals/onDevice.test.ts`). That proves the pipeline handles them, not that the model will make
the same mistakes again.

**Resolver changes** (`resolveKind`, unit-tested): a leading "a", "an" or "the" is ignored, and a few
plain words now pick the stencil an agent means. "API", "service", "processor", "component", "worker",
"consumer", "app" and "server" are a generic service ("API" used to resolve to GraphQL). "PubSub" is
Google Pub/Sub (it was a Service Bus topic). "Redis" alone is the Redis cache (it was a Redis stream).

**Expectation changes.** The requests keep their wording. Only what a model may fairly pick widened
(`accept` in `src/ai/evals/corpus.ts`, used by the on-device evals only; the corpus test still pins the
original stencil):

- create-9, "Kinesis feeds a processor": any processor passes. "A processor" names no technology, and Go
  was only what the corpus ops chose.
- create-18, "RabbitMQ routes to a Java worker": a RabbitMQ exchange passes as well as a queue. Bare
  "RabbitMQ" fits both, and routing is what an exchange does.
- create-28, "An unspecified component connects to a generic database": any generic or processing stencil
  passes for the component. "Unspecified" means the model can't pick a wrong one.

**Likely still to fail:**

- create-10, create-12 and create-21, if the model writes kinds the resolver can't map. Their Model
  output column will show which words, and those can be added the same way.
- Reversed connections in requests without a consume verb ("SNS fans out toward SQS"). These rely on the
  prompt alone.

### Round 2: after #33 and #34

**Run 1, 12 October 2026, Chrome 154: 24/37 (65%), 23 on the first try. Run 2, same build, a second PC:
22/37 (59%).** So expect about ±6 points from run to run. #34 (in between) limits each reply and each
fresh session to 30 s, with one retry in a fresh session.

| Cause                                                                                      | Run 1 | Run 2 | Fix in `feat/ondevice-accuracy-2`                                                 | Kind of fix   |
| ------------------------------------------------------------------------------------------ | ----- | ----- | --------------------------------------------------------------------------------- | ------------- |
| Runaway: edit-rename, edit-change generated for ~190–199 s, then "too big"                 | 2     | 2     | Bounded reply schema; reply cut off at 2,400 characters and retried with feedback | Retry         |
| Right label, wrong kind: create-6, 16, 17, 22 (and create-19 in run 2)                     | 4     | 5     | The label wins when the request names it                                          | Deterministic |
| A component referred to but never added: create-25 (run 1), create-15 (run 2)              | 1     | 1     | Added when the request names it; create-25's reversed connection is turned        | Deterministic |
| "between" with one side connected: edit-between                                            | 0     | 1     | Completed as `insert_between`                                                     | Deterministic |
| Omissions: create-12, 21, 28 (run 1); create-21, 25 (run 2, 25 as a self-loop)             | 3     | 2     | Completeness check and self-loop check, with specific feedback                    | Retry         |
| Example leak: create-23 (`quill.jobs`, "Quill gateway")                                    | 1     | 1     | Placeholder example names, and a runtime guard                                    | Retry         |
| Structure (Service Bus queues as "consumers"): create-29                                   | 1     | 1     | Expectation widened (any processor), but the structure is still wrong             | None          |
| Wrong components (a Lambda and a queue or topic for "a service delivers email"): create-24 | 1     | 1     | None: the expectation stays                                                       | None          |
| Not itemized in the run's report                                                           | 0     | 1     | Unknown                                                                           | —             |

**What changed:**

- **Runaways.** Every string in the reply schema has a `maxLength`: 60 for names and kinds, 160 for the
  summary, and two names for a `target` ("A -> B"). `ops` has `maxItems: 8` (the code cap is 8 too), and
  every object is closed. Where the session can stream, the reply is read as it's generated and cut off
  past 2,400 characters (no answer needs more). The retry then says why. The start of the runaway is kept
  in the Model output column, so the next run shows what the model was generating. Which field drives
  the runaway (the free-text `summary`, the `label` of a rename, or keys with spaces) is still unknown:
  the runs recorded no output, only the context error. The prompt also asks for short labels and a
  one-line summary.
- **The label wins** (`kindFor` in `src/ai/ondevice/replyChecks.ts`). When an added node's label names a
  stencil (`namedStencil`: it must share a word with that stencil's label or id), every word of the label
  is in the request, and the kind disagrees, the label's stencil is used. The kind stays when the label
  is the model's own ("billing-worker") or generic ("Orders API", or a one-word label that isn't the
  stencil's own name, like "Events" or "Gateway"). It also stays when the request names the kind too
  ("Redis cache"), or when the label names a generic stencil in the kind's role ("Cache" for Memcached).
- **Completeness** (`incompleteness`). Into an empty diagram, each component the request names must have
  its own node. Components are runs of words between verbs, prepositions and articles that
  `namedStencil` can place, so "billing" or "objects" don't count. In any request that relates things
  ("calls", "writes to", "between", "after"…), every new node must be connected. Either failure goes to
  the retry with specific feedback, e.g. "You added Redis but not the Go service, and nothing connects
  them. Add every component the request names and connect them."
- **Self-loops** are an error for the retry: "A connection can't start and end at the same node; add the
  missing component first."
- **A component connected but never added** ("Container Apps") is added when the request names it and
  `namedStencil` places it. That doesn't happen when one of the reply's new nodes is that component.
- **Direction** now covers produce verbs too ("persists to", "writes to", "calls", "invokes"…), pair by
  pair like the consume verbs. Only a connection drawn exactly against the verb is turned.
- **"between X and Y"** answered with the new node connected to only one of them becomes `insert_between`.
- **Example leak.** The examples' own components are now obvious placeholders (`sample-worker`), and
  their new nodes are named as each request names them ("MySQL", "retry queue"). A reply that uses a
  placeholder the request and diagram don't have goes to the retry: "Don't reuse names from the
  examples…".
- **Unknown references** to something that isn't in the diagram at all now say how to fix them: "ECS
  workload isn't in the diagram. Add it with an add op (with a key), then connect it by that key."
- **Expectation change:** create-29, "Publish an event to billing and shipping consumers inside an Azure
  boundary", now accepts any processor for billing and shipping, because the request names no language.
  The model's structure there is still wrong, so the case is expected to keep failing. create-24 ("A
  service delivers email") keeps its expectation.

**Projection** (per run, from which listed failures each fix addresses):

- **Deterministic fixes** (the label wins, auto-add, the one-sided "between"): run 1 → 29/37 (78%), run 2
  → 29/37 (78%). This is the floor if nothing else helps.
- **Retry-dependent fixes** (runaways, omissions, self-loop, leak) succeed only if the model follows the
  feedback. If every retry succeeds: run 1 → 35/37 (95%), run 2 → 34/37 (92%).
- **Likely: 31–33/37 (84–89%)**, if about half of the retry-dependent cases recover. Run-to-run variance
  (±6 points) applies on top.
- **Risk:** the completeness check could send a reply that used to pass into the retry. It is
  conservative, and a perfect model still scores 37/37 in the unit tests.

A unit test replays both runs' failures with replies shaped like the model's (`src/ai/evals/onDevice.test.ts`).
The deterministic ones pass on the first try, and the omissions and the leak pass on a corrected retry.

Next: re-run the evals in the Lab and paste the table here.
