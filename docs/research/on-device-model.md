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

Next: re-run the evals in the Lab and paste the table here.
