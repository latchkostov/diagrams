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
    selection and its neighbours first and says how much it left out. Then the selection as Copy for AI
    names it, then the request.
  - **Output:** `responseConstraint` is a flat op object with an `op` enum (`add`, `connect`, `rename`,
    `change`, `remove`) and optional `kind`, `label`, `sublabel`, `from`, `to`, `flow` (message or
    request) and `target`. Kinds are plain words, refs are labels, and there are no ids or coordinates.
    Per-op required fields and the 16-op cap are checked in code, not in the schema.
  - **Priming:** a system prompt plus three worked examples (a create, an edit by label, an insert
    between two nodes), created once and `clone()`d per request.
  - **Checking:** `toOps` maps the reply onto the core's ops, and `planTurn` (`applyOps`: `resolveKind`,
    `placeNew`, validation) plans it. If either fails, the error (with candidate labels) goes back to the
    model once. A second failure shows "Couldn't apply that. Try rephrasing." and nothing is applied.
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

- **Harness.** `src/ai/evals/onDevice.ts` has 36 cases: 8 edits on the Kafka example (a dead-letter
  queue after a service, rename, remove, a cache between two nodes, connect, change a kind, add an email
  sink, and a request with a selection), plus the 28 one-turn descriptions from the eval corpus, drawn
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
- **Bar:** at least 80% of cases pass before `ON_DEVICE_DEFAULT` (`src/ai/ondevice/onDevicePref.ts`)
  turns the box on without asking.

### Results

**Not run yet.** On the development machine (Windows 11, RTX 4070 Ti, 32 GB), the Chrome 154 that
DevTools automation drives reports `LanguageModel.availability()` as `"unavailable"`. That's probably
its automation profile, which can't open `chrome://on-device-internals`. Until the rate is recorded
here, the box stays behind **Try the on-device model**.
