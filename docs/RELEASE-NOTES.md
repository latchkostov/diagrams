# Release notes

## Nested boundaries final verification (#115, 2026-10-15)

- Removed boundary and annotation parents stay removed after autosave and library duplication.
  Pasted annotations join the boundary at their destination while copied subtrees keep their links.
- Native, storage and clipboard validation share the parent-cycle sanitizer; repaired native links
  produce warnings, and every boundary remains keyboard reachable. Unsupported clipboard tones
  normalize to neutral, and preset lookups ignore inherited properties.
- Ctrl+G includes selected boundaries. Copy and drag use indexed descendant traversal, and undo
  selects the moved boundary without its carried child boundaries or annotations.
- Custom captions share canvas-background measurement and include visible zone and boundary fills
  in their contrast checks. Preset captions skip measurement. Conversion rejects boundary labels
  above the annotation text limit without changing the diagram; labels exactly at the limit survive reopening.
- Refreshed generated skill code and its viewer, retaining plugin 1.1.21 (one patch above master).
  The shared sanitizer adds a small preloaded `groupHierarchy` chunk; the startup assertion pins it
  explicitly, with the entry size budget unchanged.
- Parity: only `node/i18n/catalogs.json` changes. The translated conversion text-limit error adds one
  message and changes the `edit` hash in all 38 catalogs; fallback counts remain unchanged. All
  diagram, simulation, layout, import, export and browser goldens stay unchanged.

## Nested boundaries review fixes (2026-10-15)

- Moving selected boundaries and wrapping them with their selected contents preserves their existing
  nesting, including nodes and annotations. Tab reaches enclosing boundaries before their contents.
- Boundary-to-zone conversion checks annotation geometry and count limits before changing anything,
  with recovery guidance when refused. Annotation membership uses the same geometry in drag previews
  and drop settlement.
- Clipboard boundaries receive unique IDs, valid parent references and an acyclic hierarchy before
  rendering. Indexed subtree traversal avoids repeated work during adoption, wrapping and drops;
  operation-count regressions cover child-first hierarchies at eight times the input size.
- Custom boundary names remain readable, with the chosen colour in the outline and swatch. Custom
  caption colours are retained when they meet AA against the actual canvas, including theme, tint and
  transparency; otherwise they use theme ink. Refreshed the agent viewer (plugin 1.1.21).
- Parity: the only changed golden is `node/i18n/catalogs.json`: the new annotation-limit conversion
  error adds one message in all 38 languages and updates their `edit` hashes.
  Diagram, simulation, layout, export and browser goldens remain unchanged.

## Showcase review fixes (2026-10-15)

- Phone Live menus and expectation summaries remain visible and usable with Inputs open. Inputs stays
  above playback and supports changing traffic and closing the panel at 390×844.
- Viewport-wide phone controls belong to the app shell; Interactive HTML playback stays inside its
  canvas above the export date and read-only footer. Refreshed the offline skill viewer for this fix.
- Regression screenshots now go to ignored `tests/.output` paths. Only the curated Round 41 captures
  remain in the showcase documentation; routine tests never refresh them.
- Recorded the exact eight temporary browser parity deferrals in `docs/PARITY.md`, to restore after
  `test/parity-browser-stable` lands. All 1,634 parity goldens match; these review fixes change none.

## Nightly reliability (#114, 2026-10-15)

- Dev tests wait for lazy tools, live sessions, file messages and export templates, intercept the dev image module as well
  as the production chunk, and split repeated navigation sweeps into smaller tests. Large imports use
  the navigation deadline. Vite reloads now fail explicitly, and dev-server output stays in CI logs.
- Typing regressions compare same-run main-thread CPU work through paint, excluding worker CPU contention
  and frame scheduling noise. Stress measurements omit DOM trace snapshots and retain the 1,500-node
  diagram and 1.5× ratio. Simulation samples start after worker progress arrives; the checks test
  retains its per-key run counts. Cancellation tests keep the same traffic on a smaller canvas.
- Application output is unchanged; no parity goldens changed.

## Toolchain review fixes (2026-10-15)

- CI and nightly share pnpm/Node setup, dependency caching and frozen installs. `package.json` owns
  the pnpm version, so upgrades no longer require matching workflow pins.
- Dependency-policy tests prove synchronized commands work and stale commands fail specifically
  during dependency verification, without rewriting the lockfile. App output and parity goldens are unchanged.
- Interactive HTML parity fits the settled viewer explicitly, avoiding a startup-framing race; its
  existing goldens remain unchanged.

## Public feature showcases (2026-10-14)

- Six new examples: **Partitions versus subscriptions**, **Shared API and token quotas**,
  **Serverless burst and buffer**, **Measured order capacity**, **Contoso DMZ**, and
  **Two inputs, one worker pool**. Each has two saved simulations and uses the current planning model.
- Watch idle Kafka readers versus full subscriptions, separate admitted/rejected API calls, shared
  model tokens, reserved function concurrency, measured bottlenecks, firewall blocks and shared worker
  slots. Quotas are explicitly fictional; the async function path uses a bounded invoker, without
  claiming vendor trigger retries. Examples remain lazy and use the existing themes and Lab.
- Public examples increase from 17 to 23, with reviewed checks and light/dark desktop/mobile screenshots
  in [Round 41](DESIGN-REVIEW.md#round-41--public-feature-showcases-2026-10-14).
- Phone title cards wrap the title below Live and fold long descriptions, retaining checks/reset.
  Playback controls stay in one row above the side rails, with Inputs clear of the bar.
- Output parity adds 205 Node goldens (all six examples' output families, individual validation
  transcripts and the updated skill stencil-reference fingerprint) and four stable browser renders:
  partitions, measured capacity, serverless buffering and shared workers. The
  [complete manifest](research/showcase-examples.md) explains every added file. Original aggregate
  skill outputs retain their explicit 17-example input cohort; no existing golden changes.
- Deferred eight new browser measurements pending `test/parity-browser-stable`: Contoso and quota
  initial renders, plus auto-layout/tidy for all six. Their Node goldens and production Live tests
  remain enabled. No existing browser case is excluded.
- Refreshed the stale offline skill viewer; plugin 1.1.20 is one patch above master.

## Example gallery final review fixes (2026-10-15)

- Pending cloud saves follow their initiating session into its owned copy. Marking that copy Private,
  including through New diagrams are private, cancels before provider loading or an upload can finish.
  Privacy checks and destination binding use the same ownership resolver.
- Each tab keeps an independent example session, Save destination, canvas and Undo history. Promoting
  one tab preserves another tab's pending edits; each can keep its own copy. Reloads retain conversation
  snapshots while assigning the new mounted session its own identity.
- Copy creation, library publication and source-session rotation now roll back together on storage
  failure. The first edit still saves immediately; failed retries debounce and show storage guidance once.
- Open and Run it move keyboard focus to the destination canvas after downloading an example.
  Dismissing the gallery still returns focus to its opener. No controls were added.
- No output goldens change in this round. Diagram, simulation, layout, export, agent and language
  outputs stay unchanged; the earlier gallery catalog golden change remains documented below.
  The agent viewer is refreshed; plugin version is 1.1.20, one patch above master.

## Example gallery review fixes (2026-10-15)

- Editing an example keeps its existing device or cloud Save destination. A Save that finishes after
  the edit binds to that owned copy, even after another example session has opened.
- Legacy example conversations, including Revert snapshots, migrate together with retained autosaves
  to a durable session. Reloading preserves the conversation; first-edit promotion carries it into
  Your diagrams. Legacy cloud Save bindings migrate too. A failed migration retains the source data
  and retries later; promotion publishes a fresh example identity so other tabs reject stale writes.
- Shared work always has a picker row, and older saved work remains reachable through Your diagrams
  overflow. Regression tests cover both paths and starting/restarting the currently mounted example.
- The copy notice stacks inside the canvas clear of stencil controls and action toasts. Run it includes
  its translated visible label in its accessible name. Ordinary autosaves reuse their serialized diagram.
- These fixes change no output goldens. The gallery feature's existing catalog golden change is described
  in the entry below; diagram, simulation, layout, export and agent outputs remain unchanged.
  The agent viewer is refreshed; plugin version remains 1.1.19, one patch above master.

## Example gallery (2026-10-14)

- The diagram picker now focuses on Your diagrams, with New diagram and a separate Browse examples entry.
  Recent work is capped, the current diagram stays visible, and the full library remains one step away.
- Browse examples opens a lazy gallery from the picker or start card: thumbnails, short descriptions,
  theme groups, search and a small translated Shows filter. Open edits a diagram; Run it starts its first
  saved simulation in Live. Keyboard navigation, focus return and narrow layouts work in both themes.
- An open original is labelled Example. Its first edit creates an owned copy in Your diagrams,
  using “(copy)” unless you chose a new title. It keeps Undo/Redo and live playback, and shows a quiet notice without replacing an action's Undo toast.
  Reloading a copy and returning to its source opens a pristine example; undone edits stay undone after reload.
  A cleared title becomes an owned Untitled diagram while its input stays empty for typing. Slow example
  downloads keep the edited copy mounted.
- New gallery copy is translated in all 37 locale catalogs. The development-only catalog remains available
  through its existing picker area and the gallery, using the generic catalog boundary. Its saved runs
  start in memory without putting simulation identifiers in the URL, even transiently.
- Output parity changes only `tests/parity/goldens/node/i18n/catalogs.json`: the 17 new gallery messages add
  an `examples` area hash and increase the message count by 17 in each of the 38 languages, including the
  pseudo-locale. Existing area hashes and fallback counts are unchanged. Diagram, simulation, export,
  layout and agent output goldens are unchanged. The agent viewer is refreshed; plugin version is 1.1.19.

## Self-hosting review fixes (2026-10-14)

- Cloudflare Pages preserves static assets through its native SPA fallback. Legacy and target header files
  share directory-aware routes, so cross-origin embed modules keep their CORS headers under a prefix.
- Embed code uses the prepared deployment base on deep routes; nginx redirects stay relative behind HTTPS proxies.
- Hosting-only Docker settings reuse the compiled app layer. Concurrent smoke checks own their containers
  and assigned ports, and clean up only their own container IDs, including after a failed start.

## Planning P3 final review fixes (2026-10-14)

- Planning and playback share normalized admission requirements. Imports reject duplicate quota IDs
  within each API scope and malformed caller policies with clear messages; local and shared limits
  use separate identities. Zero-duration calls still respect zero concurrency budgets.
- Fixed managed fleets scale above their saved size up to their allocation, consistently before and
  after Save. Scalar timeline edits reuse validated endpoint requirements, and checkpoints clone only
  mutable admission state. Capacity analysis indexes and aggregates endpoint calls.
- Bulk managed edits expose the same applicable controls as single selection and preserve each
  node's account and quota settings. Managed services no longer hide editable Inputs rows or inflate
  Show all counts. Zero admission capacity describes rejected calls and the limiting budget.
- Refreshed the agent viewer and native validator; the plugin remains one patch above master (1.1.18).

## Competitive landscape research (2026-10-14)

- Added a [sourced competitive landscape](research/competitive-landscape.md) covering diagram editors,
  architecture modelling, cloud tools and recent system-design simulators, with explicit verification
  limits, canvas comparisons and ranked opportunities. This is research; app behaviour is unchanged.

## Self-hosting kit (2026-10-14)

- Build a non-root Docker image or deploy with Compose, Kubernetes or Helm, including health probes, caching,
  compression and directory hosting. Application switches still apply at build time.
- Generate policies for nginx, Caddy, Netlify, Vercel, Cloudflare Pages, Azure, AWS and GitHub Pages from the
  shared security policy. The guide explains platform limitations, SSO and private embeds.
- Check deployed headers with `pnpm self-host:verify <url>` and create a versioned, checksummed offline bundle
  with `pnpm package:offline`. CI smoke-tests root and sub-path images without publishing them.

## Planning P3 review fixes (2026-10-14)

- Managed consumers respect each Kafka input group's partition assignment and drain prefetched work
  as slots free. Saving Capacity × preserves fixed managed fleets without changing account allocations.
- Capacity analysis and playback share quota identities and implicit account allocations. Endpoint
  budgets cannot collide with parent budgets, and buckets too small for one request have zero capacity.
- Live edits rebuild only affected admission policies; requests reuse compiled endpoint requirements.
  Checks remain deterministic across languages and translate cached rejection estimates when displayed.
- Managed processors retain **Emits** under **Advanced**. Admission fields explain invalid drafts and
  the retained setting, and group Undo by field. Imports reject duplicate endpoint IDs and malformed
  endpoint references; runtime references fail closed.

## Stencil catalog review fixes (2026-10-14)

- Stencil details show the actual saved default under **New nodes say**, while catalog previews retain
  translated subtitles. Add and New diagram therefore produce the text promised by the details.
- Firewall names use network-security vocabulary in French and 13 other affected locales; all 37
  language glossaries now guard names, subtitles and descriptions. Related descriptions use the same
  terminology, including repaired French and Croatian SRX descriptions.
- English and translated discovery share scoring and stable ranking. Exhaustive pseudo-locale checks
  guard display lookups, and browser checks catch vertical clipping and caption overlaps in previews.

## Stencil catalog localization (2026-10-14)

- Generic stencil names, subtitles, descriptions and vendor labels now follow the selected language
  throughout the library, gallery, previews, stencil picker and inspector. Product names retain their spelling.
- Stencil discovery matches translated text as well as English names and aliases. Changing language
  refreshes mounted results and menus while preserving the query and the diagram's own labels.
- Catalog display messages stay lazy. Stored defaults, diagram files, agent search results and schemas
  retain their English contracts; stencil behavior and simulation profiles are unchanged.

## Custom colours and canvas tint (2026-10-14)

- Annotations now support custom hex colours and a full palette, including transparency. A diagram's
  background tint follows light/dark themes, presentation, embeds and Interactive HTML exports.
- Inspecting and dismissing a picker leaves untouched colours and Undo history unchanged. Keyboard
  focus stays in the picker and returns to its opener; each colour edit is one Undo step.
- Custom annotation ink stays readable. Hex paste accepts `#`, reset restores defaults, and native files,
  draw.io and the offline agent checker share the same lossless colour contract.
- Thanks to **Heiner Morales** for the custom colours, palette picker and background tint design in
  [PR #102](https://github.com/latchkostov/diagrams/pull/102).

## Planning P3: managed compute and external limits (2026-10-14)

- Functions and external/model APIs process duration and errors and refuse calls that exceed
  concurrency, rate or token/cost budgets. Live shows Rejected separately from failures and losses.
- Versioned Lambda, Stripe and API Gateway presets cite scoped vendor quotas. Visual nodes share
  account budgets; declared endpoint budgets apply alongside global budgets. Unknown limits stay unknown.
- The inspector offers a preset and at most four main controls, with account scope and scaling details
  under Advanced. Local rate edits preserve the account cap. Automatic function scaling is explicitly
  a simplification; caller deadlines, retries and failure cascades remain deferred.
- New diagrams use p3; earlier models keep their playback until an undoable upgrade. The new controls
  are translated in all 37 additional languages, and offline agent exports use the same admission model.

## Planning P2 review fixes (2026-10-14)

- Unread subscription checks keep deterministic English findings for workers and agents; the Checks
  card translates their rationale when rendered, including after a language switch.
- Free play's Capacity multiplier now selects the matching partition or shard label for assigned
  instances and idle badges in mixed-broker diagrams.
- Editing Inputs avoids resolving service and subscription settings just to identify partitioned brokers.

## Planning P2: logs and subscriptions (2026-10-14)

- Kafka and Event Hubs assign reader instances by partitions; Kinesis uses shards. SNS, EventBridge,
  Service Bus Topic, Pub/Sub and RabbitMQ exchange fan-out can use every configured worker slot.
- Inspector and capacity readouts use each broker's vocabulary. Subscription brokers have no partition
  controls, partition preset or partition fixes, and dead-letter routes never count as subscribers.
- New diagrams use planning p2. Older diagrams retain their playback until an explicit upgrade, with
  before/after capacity and Undo. Kafka Cluster remains infrastructure, separate from a topic.
- Producer message size and ingest units are validated metadata without vendor hard ingest limits.
  The broker UI is translated in all 37 additional languages; offline agent exports use the same model.
- P1 legacy downloads remain available before upgrading. Upgrades and Undo refresh an open capacity heat map
  and live run; subscription or queue consumers retain finite network-device throughput estimates.

## Canvas localization review fixes (2026-10-14)

- Stencil search finds translated roles, categories and families, while keeping English aliases.
  Open search panels and menus refresh when a language finishes loading, preserving queries and navigation.
- RTL quick-add stays beside its prospective node in physical canvas coordinates; expanded library
  categories keep their downward chevrons. The diagram retains its direction.
- Command names come from their actions, avoiding mixed-language nouns. Annotation recovery guidance
  follows typed validation reasons, and chrome counts reuse number formatters.

## Planning P1 CI fixes (2026-10-14)

- Live stats cards open below nodes when there is room, flip above when needed, and keep covering
  lower nodes, status rings and capacity badges in both themes.
- Live callouts move clear of nodes as the canvas pans, zooms or resizes, so Properties and full
  consumer-group details remain reachable in short viewports. When the full card cannot fit, a compact
  row keeps its cause and action; the full reason stays available on hover and to screen readers.
- Naming saves each key immediately while planning waits until naming ends. Diagrams beyond the
  planning limit avoid copying the document for that readout; model previews read it only when opened.
- The Lab's inspector-focus preset renders again and retains focus requests until the matching field mounts.

## Planning P1 round 3 fixes (2026-10-14)

- Large or dense diagrams get a bounded, explicit unavailable explanation instead of blocking selection;
  moving nodes reuses the configured plan and sizing result. Current-run counters remain available when an explanation cannot be computed.
- Explanations follow the engine's current settings after Inputs changes, timeline actions and seeking.
  Upgrade and legacy export retain partial timeline edits, and sparse P1 paste preserves playback.
- Paste rejects unsupported preset revisions and invalid planning settings. Copied inferred consumer groups
  follow the new consumer IDs while authored names stay intact.
- Screen readers receive the numerical explanation. Add a consumer keeps keyboard focus on the new Label;
  open hover cards follow pan, zoom and resize. Full observed counters and group lag are available under
  Live details in Properties, including when the hover is compact.

## Planning P1 review fixes (2026-10-14)

- Private diagrams keep their flag in legacy downloads, alongside native JSON and Interactive HTML.
- Upgrade and legacy export preserve effective defaults, device sizes, saved setup and timeline behavior;
  legacy loss reports include metadata in saved simulations.
- Consumer defaults use stable node identities. Live counters reuse configured planning analysis, descriptions
  avoid per-node sizing verification, and incoming-source explanations have bounded text.
- Apply keeps current outages, keyboard focus survives disappearing actions, and tall hover cards fit short
  viewports with full details in Properties. Whole-file paste accepts the new format; sizing uses base replica
  counts consistently.

## Planning P1 (2026-10-14)

- The inspector and live hover card explain processor throughput, incoming traffic, arithmetic and
  a chosen utilization target. Orders at 3 req/s demand and 1 req/s capacity distinguishes three
  replicas at 100% from six at 50%, with one undoable planner fix.
- Read-only Connections rows derive Consumes / Publishes / Calls from current flows. Two input
  policies share one node pool; HTTP-only services have no consumer policies. Removing/reconnecting
  an edge refreshes the readout. A broker without a reader explains its producers and offers Add a consumer.
- Explicit family profiles and pinned lesson/device revisions share playback's resolver with analysis,
  checks and explanations. Existing files retain legacy playback. Diagram properties offers an
  undoable upgrade preview and legacy export with a loss report. Planning files use `diagrams/v2`;
  unsupported revisions are refused instead of substituted.
- Physical delay and store connections/query slots have distinct, bounded metadata contracts; their
  execution models remain deferred. New `planning.*` strings use `t()`; the 37 non-English languages
  currently fall back to English. No top-bar controls were added.

Changes to habits people already have. The app has no "what's new" panel, so they're noted here.

## Canvas menus and stencil chrome in your language (2026-10-14)

- Canvas number formatting stays lightweight alongside Planning P1; the agent skill viewer is refreshed in plugin 1.1.14.
- Right-click menus and their submenus, quick-add, edit feedback and Ctrl+K commands now use the chosen language,
  with translations in all 37 locales. Commands keep their stable identities when a language downloads or changes.
- Stencil categories, families, filters, gallery details, empty states and buttons are translated. Stencil catalog
  names/descriptions and authored diagram content keep their original text. Your diagrams retains its existing
  File-batch translations.
- Longer menu, palette and annotation labels wrap. Arabic mirrors the menus, opens submenus to the left and
  reverses drawer navigation, while diagram geometry keeps its direction. English wording remains unchanged.

## AI language switching fixes (2026-10-14)

- Visible microphone and on-device model errors now update when the language changes, keeping the request drafts.
- New conversation reverts keep their target as metadata, so their labels follow language changes after reload too.
  Previously stored revert labels remain readable in their original language.
- Complete AI shortcut combinations stay left to right inside Arabic and Hebrew sentences and tooltips on macOS.

## AI and keyboard labels in your language (2026-10-14)

- The AI panel's dock, conversation, Advanced copy-and-paste flow, dictation notices and on-device model
  controls now use the chosen language, with translations in all 37 locales. Agent prompts, WebMCP tool
  contracts and results, and diagram content keep their original text.
- Keyboard labels follow the language and OS across the shortcuts sheet, menus, tooltips and palette:
  German Strg and Umschalt, French Maj, and macOS modifier symbols. The sheet's Live and presenting rows
  are translated too. Long labels wrap, and Arabic mirrors the panel while keeping key combinations readable.
- Sending, dictation, inference and pasted replies work with English fallback while a language downloads
  or fails to download. English wording, punctuation and number presentation retain their previous output.

## Properties in live view (2026-10-14)

- Double-click a node, boundary or connection in Live to open its property sheet, even when collapsed, with the
  whole Label selected. F2, Enter, Rename and Ctrl+K do the same. Presentation and read-only viewers stay inert.
  Enter still continues a waiting narration; F2 can open properties while it waits.
- Names use the inspector's existing simulation behavior: node names and subtitles restart the run; boundary
  and connection labels do not. Live's other gestures are unchanged.
- Opening properties makes room beside the canvas by closing Inputs or Simulations. An unsaved simulation
  draft comes back when Simulations reopens.

## File dialogs in your language (2026-10-14)

- Open, import, export, embed, password links and cloud-storage dialogs and messages now use the chosen language,
  with translations in all 37 locales. Counts, sizes and file dates follow that language too.
- Diagram text, code snippets, file formats and product names stay as written. Arabic mirrors the dialogs;
  long translations wrap in the same compact layout, with export options still behind Options.
- Saving to this device and downloading diagram files work while notification messages download, and when that
  download fails. Native Open and Save retain the browser gesture that allows their pickers to open.
- Cancelling Paste also cancels an import waiting for its messages. Import reports follow language changes when
  reopened, including reasons, notes and reports drawn again from retained import data.
- English keeps its previous wording and formatting after extraction: storage failures name their provider,
  image failures name their format, and locked copies retain the warning when someone sends a link. Library
  pagination, detail spacing, import counts and lists, file sizes and traffic units keep their original output.

## External discovery (2026-10-14)

- **Clients & external** brings External API, Webhook, Email, SMS, Mobile Push, Marketing Automation and LLM API
  together with clients and vendor APIs in the stencil library and gallery. Quiet headings separate clients and
  webhooks from called external systems.
- **Iterable, Braze, Segment, Shopify, PayPal and Adyen** now have named stencils with reusable generic glyphs.
  Search them by name or find integrations with “external”, “third party”, “API”, “SaaS”, “webhook” or “vendor API”,
  including Ctrl+K and agents' `find_stencils`.
- This adds discovery only: simulation roles stay as before; no vendor quotas, rate-limit defaults or endpoint editor.

## Inspector naming reliability (2026-10-14)

- Quick-add and Rename keep their focus request until the selected node's Label is ready, including when the
  inspector is opening after a pointer gesture. A previous node's name never takes the request.
- Typing names keeps node positions and connection routes stable until the measured bounds change, avoiding
  repeated routing work on large diagrams. Growing cards and connection labels still update their routes.
- Live callout counts use equal-width digits, so changing digits no longer nudges the adjacent Revive button.

## Naming follow-ups (2026-10-14)

- Typing a boundary name keeps distant connections' routes cached. Connections near its growing or shrinking
  label still update immediately.
- Backspace straight after a quick-add pick keeps the name empty when the inspector opens, ready for typing.
- Regression coverage now checks that clicking away or folding the inspector finishes a rename as its own undo step.

## Renaming in the inspector; selected text you can see (2026-10)

From the owner's reports (docs/DESIGN-REVIEW.md, round 34). Habit changes:

- **Double-click a node, a boundary or a connection to open it in the inspector**, its **Label** focused with all of
  it selected: type the new name, then **Enter** (or **Esc**) to go back to the canvas. Nothing opens on the canvas
  for them any more. **F2**, **Enter** on a selected one and the menus' **Rename** and **Edit label** do the same, and
  open the inspector if it was hidden. **Tab** goes to the Subtitle.
- **Quick-add names the new node in the inspector** (a double-click on the canvas, a dropped connection, Alt+arrow,
  the "+"): type its name straight away, as before. A node made connected shows a **Connection** field one Tab after
  the Subtitle while it's being named. The node, its connection and their names are still one undo step.
- **Texts, notes and zones are still edited in place**: their words are the thing.
- **Selected text shows**, in every field, in both themes. Every editor on the canvas (a boundary's or a node's name,
  a note) painted its selection transparent, so a double- or triple-click selected the words without showing it
  (typing still replaced them). Double-click selects a word and triple-click the line, as everywhere else.
- Live, presentation, read-only views, embeds and the HTML viewer open no editor on a double-click or F2.

## Editing reliability (2026-10-14)

- The inspector stays folded during a drag even when another drop's deferred update is still waiting.
- Run simulations from Ctrl+K or the canvas right-click keeps playing when the Checks card opens in development.

## Simulation review, round 3 (2026-10)

- Live reports losses between trend samples, including the last partial second of a finished run. Broker outages
  say messages were dropped on arrival; delivery-limit losses offer a dead-letter queue. Only playback's selected
  dead-letter route exempts its target from lag warnings.
- Large bursts no longer cost a full travel-array scan every tick or frame. Broker throughput stays unlimited;
  paused sinks ignore saved latency when revived, matching the inspector.
- Continuous traffic keeps the 10,000,000 msg/s input limit, with a sampled rate and per-run source budget. Unsafe
  scale combinations explain how to change Inputs; reaching the volume budget shows a notice and requires Restart.
- Callouts reserve room for Back to editing, and Show events remains usable during slow motion. Adding a dead-letter
  queue is covered through delivery and one-step Undo; staged-backlog tests now require progress and full draining.

## Simulation review follow-up (2026-10)

- A saved sink latency really does nothing: topic delivery stays immediate. Large consumer groups refresh their
  delivery limits without rescanning all routes, and outage details use indexed memberships.
- Live reports losses in short runs, keeps an ongoing lag warning after seeking, and stops calling a flat backlog
  rising. A warning hidden behind Inputs keeps its turn; an unrelated capacity diagnosis no longer hides it.
- A down broker fed by another broker says its messages wait there, matching playback and the heat map.
- Trouble announcements update an already mounted live region, callouts stay clear of the title with the AI panel
  open, and removing a saved inert setting keeps keyboard focus in the inspector.
- Checkpoint restoration preserves consumer IDs such as `constructor`; the on-device DLQ eval requires a route
  playback actually classifies as dead-letter.

## The simulation tells the truth (2026-10)

From the simulation flows review (docs/research/sim-flows-review.md, items 1–6; docs/DESIGN-REVIEW.md, round 32).
Habit changes:

- **Consumers behind a topic or queue keep up at the rate the heat map says.** A default consumer drained about
  3.5 msg/s behind a broker while every number said 16, so "Healthy" sat over a lag that only grew (the GCP example
  did it at "13%"). A delivery now takes its consumer's slot when it arrives. Runs of diagrams with brokers look
  calmer: lag builds only where a consumer really can't keep up.
- **Messages move faster by default**: an edge without its own travel time takes 300 ms (a request 200 ms); it was
  900 / 450. Edges that set one keep it.
- **Live tells you what's going wrong without being asked**: a node that's down (**Revive**), messages being lost
  (**Add dead-letter queue**), a lag that keeps rising (**Inputs…**). Each comes once per run, and **×** dismisses it.
  Nothing appears while presenting, recording or in an embed.
- **A down consumer behind a queue says its messages wait**, "Messages wait in orders until it's back (49 so far)", not
  that they fail.
- **A new connection into a database, gateway or outside API, or out of a browser or app, is a Request** (solid);
  into or out of a topic or queue it's a Message, as before. The first time, a toast offers **Make it a message**.
  Agents' `connect` without a `kind` does the same. Existing diagrams are unchanged.
- **The inspector hides fields that do nothing**: a gateway's Concurrency, a sink's Latency, and Consumer group and
  Dead-letter path on connections that don't leave a broker. A value already saved stays, with a note and **Remove**.
- **Rates go up to 10 million msg/s** everywhere (they stopped at 10,000 in files and the Inputs panel, but not in the
  inspector, so a saved 50,000 wouldn't open again). Fields stop at the file's limits and say so, and a refused file
  names the field: "ratePerSec 20,000,000 is over the 10,000,000 limit".
- **The callout sits clear of the diagram's name** on narrower screens (it covered the title card's first words).
- The chatbot prompt's dead-letter example hangs the queue off the topic (it copied every message from the consumer).

## Languages (2026-10)

- **Live Diagrams opens in your browser's language**, in 37 languages beside English: Arabic, Bulgarian, Chinese
  (Simplified and Traditional), Croatian, Czech, Danish, Dutch, Estonian, Finnish, French, German, Greek, Hebrew,
  Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Norwegian, Polish, Portuguese (Brazil
  and Portugal), Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian and
  Vietnamese. A browser set to English sees no change.
- **View ▸ Language…** (and Ctrl+K, "Language…") picks one: every language by its own name, Browser default first. The
  choice is kept in this browser; **Clear everything on this device…** forgets it, with the rest of your settings. When
  the app isn't in English, the View menu's row also says "Language", in English, so it can always be found.
- **What's translated so far:** the start card, the top bar, the File, View and presenting controls, Share…, the
  keyboard shortcuts, and the Private diagram and Clear everything dialogs. The rest is English for now, area by area
  (docs/I18N.md). **Your diagrams are never translated**: labels, notes and titles stay as you wrote them, and so do
  product names (Kafka, PostgreSQL) and files.
- **Machine-translated, and it says so.** The Language dialog links to a prefilled GitHub issue to suggest a better
  translation.
- **Arabic and Hebrew** read right to left: the top bar, menus and dialogs mirror; the diagram doesn't (it reads the
  same for everyone).
- Numbers, percentages and "5 min ago" follow the language (1.234 in German, "vor 5 Min."); English keeps its wording,
  with thousands now grouped ("1,234 nodes").
- **Self-hosting:** `VITE_LOCALES` limits a copy's languages or sets one for everyone (docs/SELF-HOSTING.md).

## On-prem network devices (2026-10)

Routers, switches, firewalls and load balancers you'd have in your own racks (docs/DESIGN-REVIEW.md, round 31).

New:

- **An On-prem network section** in the stencils, with a **Network vendors** family filter. There are 19 stencils:
  - a generic Router, Switch, Firewall (NGFW) and ADC;
  - Cisco ISR, Catalyst, Nexus and Secure Firewall; Juniper MX, EX, QFX and SRX; Arista; HPE Aruba CX;
  - Palo Alto NGFW, FortiGate, Check Point Quantum, F5 BIG-IP and NetScaler.
- **Search finds model numbers and jargon.** "3825" or "ISR" finds the Cisco router; "BIG-IP", "NGFW", "spine" and
  "leaf" work too. They're drawn as device glyphs, with the vendor as the stencil's name and colour.
- **Sizes.** A device's Simulation settings start with **Size** (branch, campus or data centre). Each size's throughput
  and latency come from a named model's datasheet, for example "Campus: PA-3440, 20 Gbps". A note says what that is in
  messages per second at the **Message size** (64 kB unless you change it). Every number is approximate and yours to
  change.
- **High availability.** A device can be an **active-standby pair** (one unit carries traffic; when it fails, the
  standby takes over in a few seconds and nothing is lost) or an **active-active cluster** (the units' throughput adds
  up). In live view, a pair's Behaviour menu has **Fail the active unit**.
- **Firewall rules.** A connection leaving a firewall is a rule: **Allow** or **Deny**, in its inspector. A denied one
  shows a "no entry" glyph. In live view what it stops shows as **blocked** on the firewall, never as failed, dropped
  or lost.
- **Load balancers health-check their targets.** An ADC (F5, NetScaler, the generic one) sends nothing to a target
  that's down while another is up.
- **Capacity sees the devices.** Show capacity and the Inputs & capacity panel colour a device against its throughput
  ("1% · 440/s of 39k/s"). Check diagram's "can't keep up" offers the next size up, and "every request goes through
  one" offers **Make it an HA pair**.
- **A new example**, Branch office to data centre, with two simulations: one firewall fails over, and the firewall
  blocks the branch from payments.
- **draw.io imports** read the Cisco library's routers, switches, firewalls and load balancers.

Nothing changes for diagrams you already have: existing gateways (nginx, HAProxy, Load Balancer, Firewall / WAF) behave
as before. A file whose connection has a `deny` that isn't true or false opens with it read as deny, and says so: a
firewall rule never quietly turns into Allow.

## Live explains itself (2026-10)

From the owner's own diagram (docs/DESIGN-REVIEW.md, round 30). Habit changes:

- **A topic or stream nobody reads says so.** Live view no longer calls it "can't keep up at all", "No capacity · 2/s
  waiting" or lag: the banner says **Nobody reads Kafka Topic** with one action, **Add a consumer**, the badge
  **Nobody reads this yet · 297 kept**, and the heat map paints it amber, not red. A queue nobody reads still shows its
  messages **queued** and **waiting**. Paused and down keep their own words.
- **Changing a node's stencil changes its connections' relationships too**, in the same undo step: a flow into a node
  that becomes App Configuration turns **Config** and stops carrying requests in Live; a toast says what changed, with
  **Undo**. One you chose yourself (Relationship ▸, Make it a flow) never changes by itself. Agents' `update` with a new
  `kind` does the same and lists the connections in its result.
- **Partitions say what they do**, under the field: how many consumers in one group work in parallel; they don't speed
  up publishing. Raised in the Inputs panel where they can't help, a line says why.
- **Config and Secret connections say why nothing flows over them**: read at startup and refreshed, not on every
  request. Secret's menu hint is "Secrets it loads, then refreshes" (it was "Secrets it resolves, usually once").
- **A live hover card is never covered** by the node under it (its ring or capacity chip showed through).
- Slow motion says "1,240 waiting" for a service's backlog (it said "lag"), and the trace card's status is **Kept** for a
  message a topic nobody reads keeps.
- Saved files may carry `relationOrigin` on an edge (`inferred` or `explicit`): older builds keep it and ignore it.

## Full screen while presenting (2026-10)

- **Presenting has a full-screen button**, beside **Exit presentation** (the corners icon), and **F** does the same.
  The whole page goes full screen, so live view, slow motion, the trace and toasts keep working as they were. **F** or
  **Esc** comes back; leaving with the browser's own Esc or F11 updates the button.
- **Esc while full screen leaves full screen only.** The next Esc leaves the presentation, as before. Leaving the
  presentation any other way (Exit presentation, Back) leaves full screen too.
- Where the browser can't go full screen (iOS Safari, a page framed without `allow="fullscreen"`) there's no button.
  Embeds and the Interactive HTML viewer have no presentation, so no full screen either.
- **Exit presentation is easier to read** at rest (it was faint, below the contrast it needs), as is the new button.
- The **Present** button's tooltip no longer says "full screen": presenting hides the editing chrome; full screen is
  the new button.

## Share…: every way out, safest first (2026-10)

The File menu's link rows are one row, **Share…** (docs/DESIGN-REVIEW.md, round 27). Habit changes:

- **Copy share link, Copy link with password… and Embed code… are gone from the File menu and the right-click's
  Export ▸.** In their place, **Share…** opens a list of every way out, each saying who can open what it makes:
  **Interactive HTML…**, **Diagram file**, **Embed in your app…** and **Link with password…** first, with the keyboard
  on Interactive HTML.
- **A public link takes one more step.** Share link… and Embed on a public page… are folded under **Public link or
  embed · anyone with the link can open it**, last, and Share… opens folded every time. Share link… opens the Share
  link dialog, where **Copy link** copies it (the toast says anyone with the link can open the diagram). There's no
  one-click copy any more.
- **Ctrl+K**: "Export › Share…", found by "share", "link", "password" or "embed".
- **The password link's dialog is titled Link with password**, as its row is.
- **Embed code opens on one kind**: Embed in your app shows only the private embed your app supplies; Embed on a
  public page shows In the link (and Example by name for an unedited public example).
- **A Private diagram's Share…** lists the two files and Embed in your app, with one line saying why links are off and
  **Make it not private…**. A company's copy without share links lists those three and nothing else.
- **Exporting the diagram file says who can open it** in its toast.

New:

- **The first Import report of an infrastructure file** (docker-compose, Kubernetes, AsyncAPI, Terraform) offers **New
  diagrams are private**, unticked, under Make it private. It asks once; Clear everything on this device asks again. It
  never turns on by itself.
- The agent skill and `llms.txt` point to **File > Share… > Link with password…**.

## Privacy audit (2026-10)

An end-to-end check of everything that could carry a diagram out of the page or keep it longer than you meant
(`docs/PRIVACY-AUDIT.md`). Habit changes:

- **A password-protected Interactive HTML file keeps its neutral title once it's open.** The tab says **Diagram
  (password protected)**, not the diagram's name: browsers keep page titles in their history, and sync it.
- **A private diagram's simulation stays out of the address bar.** Live view still adds `live=1`, but no longer the
  simulation's id (ids can be made from the diagram's words, as a storm's is), so a reload of a private diagram plays
  freely rather than that simulation.
- **Deleting a diagram deletes its AI conversation too** (Undo puts it back), and a shared diagram replaced by another
  link takes its conversation with it.
- **Ctrl+K doesn't remember a private diagram's nodes or simulations** among its recent commands.
- **Copy Mermaid and draw.io on a private diagram** no longer suggest mermaid.live or app.diagrams.net: the toast says
  to keep it where your team controls access.
- **A link embed won't show a diagram marked private** (no app makes such a link; one made by hand or by an older
  copy now says the diagram is private, with no link out).
- **Exported images leave out the Checks card's markers**, which carried the findings' words.
- **Dictation says where your voice goes, every time.** While the browser's speech service listens (not the device),
  a muted line by the mic says "What you say may be sent to Google's speech service." (Microsoft's in Edge, Apple's in
  Safari). It used to say so once per browser.
- **Making a diagram Private offers Clear conversation** when it has an AI conversation (one step, with Undo).
- **Agents told no by a private diagram** hear "Private diagrams are excluded from AI…", not "Local-only…".
- **The Lab (`?view=lab`) is gone from the published site**: it's a development tool, in dev and test builds only.
  The on-device evals run from `pnpm dev`.
- **Embeds write nothing to this browser's storage.** They still read your saved theme; a theme the host page sets
  lasts as long as the embed.
- The agent skill's HTML viewer (plugin 1.1.2) keeps a password-protected file's neutral title once it's open.

New:

- **File ▸ Privacy ▸ Clear everything on this device…** deletes everything Live Diagrams keeps in this browser (every
  diagram, private ones included, edits to examples, AI conversations, file destinations and settings), after one
  confirmation (**Cancel** is the default), then starts over. Other open tabs start over too. Files you saved or
  exported, and cloud copies, stay where they are.
- Opening the File menu no longer warms up Google Drive's scripts while a private diagram is open.
- Embeds' Content-Security-Policy allows this site only: no storage provider's scripts, frames or endpoints.

## Checks: the owner's decisions (2026-10)

Habit changes:

- **Services reading secrets without an identity: the fix now gives each service its own identity** ("Add managed
  identities", one named for each service), so each signs in only to what it reads. The chip under it, **One shared identity**,
  adds one they share, as the button used to. Past 50 services one each is too big for one step: the button adds the
  shared one and the row says why. Agents get the per-service ops in `fix.ops` and the shared one in `fix.others`.
- **Run simulations reports; it doesn't fix.** **Messages are lost at …** no longer offers **Add dead-letter queue**
  (nor does `check_diagram`): it says what was lost, where and how many. The static check **Failed messages are
  dropped** still offers that fix, counts or not.

New:

- **Run simulations from Ctrl+K and the canvas right-click** (after Check diagram), while editing a diagram with saved
  simulations. It opens the Checks card if it's closed, then plays; while they play the same row is **Stop
  simulations**. Never in live view, presenting, embeds, read-only views or exported files.

Unchanged, on purpose: **{client} calls {service} directly** stays quiet when the diagram draws no gateway at all.
Most diagrams that leave it out do so on purpose.

## Run simulations in the Checks card (2026-10)

No habit changes: nothing plays until you ask, and the count under the title is as it was. New:

- **Run simulations**, under the Checks card's summary when the diagram has saved simulations, plays each of them
  without going live (a minute of simulated time each at most) and counts the messages they lose. The counts go under
  the finding they bear out: "30 dropped in “Poison invoices”" under **Failed messages are dropped**.
- Losses no other check explains are a new suggestion, **Messages are lost at …** (with **Add dead-letter queue** at a
  queue or topic), or **Failed requests to … are lost**. It never adds a warning.
- What a simulation loses on purpose (a node it takes down or makes fail, or what its own expectations count on) is a
  muted **On purpose:** line, not a finding: an outage story isn't a design problem. Backlogs and overload aren't
  counted at all; live view's capacity heat map shows them.
- It plays in the background: **Playing 2 of 5: “…”…** says where it is, and typing and dragging don't wait. **Stop**,
  **Esc**, closing the card, going live or an edit stop it at once. Moving or selecting things doesn't.
- The counts are never saved in the file or shared. An edit hides them (**The diagram changed since the simulations
  played. Run again**); Undo brings them back. Private diagrams can run them too: nothing leaves the device.
- Agents: `check_diagram` takes `simulations: true` to do the same (off by default; it takes seconds on a large
  diagram).

## Interactive HTML with a password (2026-10)

No habit changes: the export is as it was unless you turn the new option on. New:

- **Require a password** in **File ▸ Export as ▸ Interactive HTML…** (off by default). The password field is the one
  from Copy link with password… (at least 8 characters, a strength hint, Show), and the dialog then says **Only
  people with the password can open it.** Send the password separately.
- The file is encrypted in your browser with the same crypto as links with a password (AES-256-GCM, the key from
  PBKDF2-SHA-256 at 600,000 iterations). Nothing of the diagram is readable without the password: not its title,
  labels, notes, simulations or banner. It's named **Diagram (password protected)** and a few random letters, so two exports never share a name.
- Opened, it asks for the password, says when it's wrong (try again as often as you like), and plays as before. It
  still works offline and makes no network requests. The password is never stored or sent, and it can't be
  recovered: if it's lost, export again.
- Private diagrams can export it too, as they could without a password. So can a company's own copy with links
  turned off: it's a file.
- It unlocks from disk (checked in Chromium, Firefox and WebKit, Safari's engine) and on `https://` hosts. A plain `http://` intranet host can't
  decrypt it: the prompt says to open the file from disk.
- The Agent Skill's `export-html.mjs` takes `--password`. It never takes the password on the command line: it asks in
  the terminal, or reads `LIVEDIAGRAMS_HTML_PASSWORD`. `export-html.mjs` no longer replaces an existing file: a taken
  name gets the next free one (it says which), and `--force` replaces. The skill offers the password for company content and never
  asks for it in the chat.

## Imports: big ones, replicas, KafkaUser ACLs (2026-10)

One habit change: **a big import draws part of itself.** Past 300 nodes, a Kubernetes, Terraform, AsyncAPI or compose
import with two or more boundaries draws the boundaries with the most flows, and the toast says so ("300 of 1,240
nodes"). **Details** lists every boundary (and what's in none) with its nodes and flows, the drawn ones ticked;
tick others and **Draw these** opens them as a new diagram named by what it draws (the first stays as it is). An
import over 5,000 nodes, which used to fail, now opens this way when it has boundaries. **Draw everything** still
draws every resource, up to 5,000. Also:

- **Replicas.** A Deployment's `replicas: 1` (or compose's `deploy.replicas: 1`) is now written to the node, so the
  "Every request goes through one …" check sees an imported single replica on the only way in. A count the file
  leaves out stays unset, as before; under an HPA or KEDA, only the autoscaler's own minimum counts.
- **Strimzi KafkaUser ACLs.** A workload that uses a KafkaUser's Secret gets that user's topic ACLs as flows: Write
  produces, Read consumes (in its group ACL's consumer group). A deny ACL always wins: a flow it forbids is never
  drawn. Prefix, wildcard and host-limited ACLs are listed in the report.
- **Terraform.** Long module addresses in the report wrap between their parts and can be selected and copied whole.
  **Draw everything** is compact: helpers pack in a grid instead of spreading the first column down the page. A
  Function App that reads Key Vault through its own managed identity says "managed identity" on that connection.

## Checks: secrets and schemas (2026-10)

No habit changes: the count under the title still shows warnings only. Two more checks, in the **Checks card**:

- **{n} services read secrets without an identity** (a suggestion, once per diagram): services with a Secret
  dependency on Key Vault, Secrets Manager, Secret Manager or Vault, and no Identity dependency. The fix, **Add a
  managed identity** (an IAM role on AWS, a service account on Google Cloud), adds one identity and connects each
  service to it; **One for each service** gives each its own. It stays quiet where the diagram already says how they
  sign in ("managed identity" on the vault, say), and for Vault read by services on no cloud.
- **Avro on {topic}, but no schema registry** (a warning): a Kafka topic whose content type or label says Avro or
  Protobuf, in a diagram with no schema registry. **Add Schema Registry** adds one with a Depends on from each producer
  and consumer. AsyncAPI imports already add the registry, so they're flagged only if it's taken out.
- Both fixes only add: dependencies carry no traffic, so the simulation plays exactly as before.
- Agents' `edit_diagram` can now draw a dependency: `connect` takes an optional `relation` (`secret`, `identity`,
  `config`, `telemetry`, `deploy`, `depends`). Without it, a connection is a flow, as before.

## Ids: one per element, so edits never hit the wrong thing (2026-10)

No habit changes. A fix for files that give two elements one id, usually a node and a connection (hand- or
agent-written files, some imports):

- **Opening such a file renames the later one** ("billing-db" becomes "billing-db-2"; nodes keep theirs), and the
  import toast says so. Nothing is dropped: two nodes, two boundaries or a note with a node's id used to stop the
  file opening or lose the second one; both are kept now. A boundary's members follow it, and an ignored finding
  stays ignored for each.
- **Edits act on the kind they name.** Removing or updating a connection through the AI panel, an agent
  (`edit_diagram`) or a Checks fix never removes or changes a node, and new nodes, connections, boundaries and notes
  never take an id something else has (pasting and duplicating too).
- **Checks offer their fixes again** on those connections: they were held back while an id could name a node too.

## Checks: four more (2026-10)

No habit changes: the count under the title still shows warnings only, and a diagram that was clean before stays
clean unless it has one of these. New, in the **Checks card**:

- **{n} requests deep** (a warning): requests that go from service to service four or more times in a row. Each one
  must be up for the first to answer. The fix makes the last call a message.
- **{service} uses {owner}'s database** (a warning): a service reaching into a database that a boundary's own service
  uses. The fix, **Ask {owner} instead**, replaces that connection with a request to the owner, label kept. When
  several services in the boundary share the database, it's a suggestion, with no fix.
- **{client} calls {service} directly** (a suggestion): an outside client going around the way in the diagram draws
  (a gateway or load balancer the other clients use). The fix goes through it; chips under the button add a new
  gateway instead (API Management or Front Door on Azure, API Gateway on AWS, Cloud Load Balancing on Google Cloud,
  else a firewall or Kong). Each is offered only when it keeps every connection's traffic as it was; when the direct
  connections carry settings (a filter, a message type, timing), the row says so and has no fix. Diagrams that leave
  ingress out entirely aren't flagged.
- **Every request goes through one {node}**: a service or gateway you run with one replica that is the only way
  through for an entry point. A suggestion when the diagram says `replicas: 1`; a warning when it's 80% busy or more
  at the diagram's own rates. The fix sets replicas. A replica count you never set isn't read as one (unless it's
  busy).
- Agents' `check_diagram` reports them too, with their fixes as edit operations.

## Sharing says who can open it (2026-10)

Two small habit changes:

- In the File menu, the arrow keys now **stop on rows that are off** (a Private diagram's link rows), so the keyboard
  and screen readers hear why they're off. Enter on one does nothing.
- When a link is refused for a Private diagram, the message's button is **Interactive HTML…** (it used to export the
  diagram file).

New:

- **Every way a diagram leaves the app says who can open it**: Copy share link ("Anyone with the link can open it",
  in the menu and its toast), Copy link with password… ("Only people with the password can open it"), and **Embed
  code… ▸ In the link** ("Anyone who can see the page can open this diagram"). Interactive HTML and the private embed
  already did.
- A Private diagram's off rows, the Privacy submenu and the Private dialog name the way to share it: **Interactive
  HTML** (or the diagram file). The reason under an off row stays readable in both themes.
- The Embed dialog is titled **Embed code**, like its menu row, and Esc closes the Share link and Embed dialogs as soon
  as they open. In the embed preview, Esc goes back to the dialog (the next Esc closes it).
- A password link whose password is still being checked never opens over a diagram you moved to meanwhile.
- The Agent Skill mentions **File > Copy link with password…** for a link only some people can open.

## Import Terraform plans and state (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read the JSON from **`terraform show -json`**, a plan or a state, several files
  at once. Queues, topics, functions, databases, secrets and identities on AWS, Azure and Google Cloud get their
  stencils; modules (or Azure resource groups) become boundaries.
- Subscriptions, event-source mappings, EventBridge targets, Service Bus and Event Grid subscriptions and Pub/Sub
  subscriptions become **message flows**, so SNS → SQS → Lambda reads as it runs. References between resources
  become **Identity**, **Secret**, **Config** or **Depends on**, and IAM policies and Azure role assignments say who
  reads which secret and who sends or receives.
- The Import report lists what wasn't drawn by type (policies, networking, helpers), the plan's changes, and
  **Draw everything**, which opens the same files with every resource as a node.
- Sensitive values, variables and outputs are never read. A `.tf` file says to run `terraform show -json plan.out`
  and import that.

## Private embeds: your app supplies the diagram (2026-10)

Nothing you do today changes: embed codes made before work as they did. New:

- **Embed code…** has a third source, **Your app supplies it (private)**. Your page loads a small script from
  livediagrams.dev and fetches the diagram from your own server, behind your own sign-in, then hands it to the
  viewer. The diagram never leaves your app: it isn't in any URL and never reaches livediagrams.dev, which only
  provides the viewer.
- Two ways in, both copied from the dialog: the `<live-diagram>` web component
  (`<live-diagram src-json="/diagrams/orders.diagram.json" simulation="black-friday" autoplay>`), or a plain iframe
  with a few lines of `postMessage`. **Diagram file** in the dialog saves the file to serve.
- Your page can drive it (play, pause, speed, simulation, fit, theme, highlight nodes, load another diagram) and hear
  from it (node clicks, play state, the height that fits the diagram). The reference is `docs/EMBEDDING.md`.
- **Private diagrams can now be embedded this way.** Embed code… used to be off for them; it now opens with only
  this source, since nothing of the diagram goes in the code. Share links and link embeds stay off for them.

## Agent Skill: asks what you want back, and makes Interactive HTML (2026-10)

One habit changes for people who use the livediagrams Agent Skill: it **asks which output you want** before it hands
the diagram back, unless you already said. Update the plugin in Claude Code (`/plugin`), or download the skill again
for the Claude apps and Codex.

- **Interactive HTML file**, offered first and recommended for anything about your work or company: the same file as
  **File ▸ Export as ▸ Interactive HTML…**, made on your computer by the skill (`scripts/export-html.mjs`). It plays
  the simulations, works offline and makes no network requests, and only people who have the file can open it. Ask
  for a banner such as "Confidential".
- **Diagram file** (`.diagram.json`) to keep editing, **Image** (the skill says how to export one from the app) and
  **Share link**, which the skill now says anyone who has it can open. A private diagram never gets a link.
- For work diagrams the skill marks the diagram private (`"private": true`).

## Import Kubernetes manifests (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read **Kubernetes** manifests, several files and documents at once
  (`kubectl get … -o yaml` or `-o json` too). Namespaces become boundaries, workloads get stencils from their
  images, Services lead to the workloads they select, and an Ingress, a Gateway or a LoadBalancer Service is the
  entry from Users.
- ConfigMaps and Secrets become **Config** and **Secret** relationships named by their keys. A Secret's values are
  never read. Workload identity (Azure, AWS IRSA, GKE) becomes an **Identity** relationship.
- Connections come from settings as in docker-compose, and from **KEDA** triggers (Kafka, RabbitMQ, SQS, Service
  Bus): the topic or queue sends to the workload it scales. **Strimzi** topics join with them on their cluster.
- The Import report lists what wasn't drawn by kind ("ServiceMonitor orders-api: unknown kind") and each scaler's
  replica range. A Helm chart's templates say to run `helm template` and import its output.
- New stencil: **Service Account** (Google Cloud).

## Checks (2026-10)

No habit changes. New:

- **Checks** find likely design problems as you edit: failed messages that are dropped (no dead-letter queue), a topic
  or queue nobody reads, requests that go round in a circle, and a service that can't keep up at the diagram's own
  rates. When there's a warning, a muted **⚠ 1 warning** appears under the diagram's title; suggestions alone show
  nothing.
- **Check diagram** (that count, the canvas right-click, Ctrl+K or View ▸ Checks) opens the **Checks card**. Each
  finding names what it involves (click to select it), says why it matters, and offers a fix ("Add dead-letter
  queue") as one undo step. **⋯ ▸ Ignore here** (with an optional reason) and **Turn off this check** are kept in the
  file, so whoever opens it sees the same; the card's foot brings them back.
- While the card is open, small markers show on the nodes and connections it names. Select one and its finding is at
  the top of the inspector.
- Checks run in the background after you pause, so typing and dragging don't wait. Live view and presenting show no
  count; private diagrams are checked like any other, on this device.

## Interactive HTML export (2026-10)

Nothing you do today changes. New:

- **File ▸ Export as ▸ Interactive HTML…** (also the canvas right-click's Export ▸ and Ctrl+K) downloads one
  `.html` file with the diagram and its simulations. Open it in any browser, or put it where your team already
  controls access (SharePoint, Confluence, an internal site, a repository): no public link, no account, no internet.
- In the file, people pan, zoom and play the simulations (pick one, pause, change the speed, trace a message, slow
  motion). They can't edit it, and it opens nothing else: it makes no network requests and saves nothing in the
  browser.
- **Options** sets the title, a banner across the top (say "Confidential: internal use only"), light or dark, which
  simulations go in and which one plays when the file opens.
- Private diagrams can be exported this way too, like saving them to this device. Anyone who has the file can open
  it, and the dialog says so.

## Import AsyncAPI documents (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read **AsyncAPI** 2.x and 3.x documents. Open several at once and they join
  into one system on their channels: a producer in one file and a consumer in another become one flow. Servers
  become boundaries, channels get their broker's stencil (Kafka, RabbitMQ, Service Bus, SNS, SQS, Pub/Sub, MQTT…),
  and edges carry the message types.
- Each import saves an **Imported traffic** simulation: Go live and pick it to watch the messages flow. The Import
  report says where the traffic starts and how fast.
- References (`$ref`) are followed inside the files you open; a remote one is never fetched, and the report lists it.
- New stencil: **MQTT Broker** (also for Mosquitto, EMQX and HiveMQ in docker-compose files).

## Import docker-compose files (2026-10)

One habit changes: **Open…** and a drop take several files at once. Opening one file works as before. New:

- **Open…**, a drop and **Import from ▸ Paste text…** read a **docker-compose** file. Drop it with its
  `docker-compose.override.yml` (and a `.env` file it names) to merge them the way Compose does. Each import
  makes a new diagram in Your diagrams: services on their stencils (PostgreSQL, Kafka, NGINX…), the networks
  as boundaries, and connections found in the files, including settings such as `DATABASE_URL` or `INPUT_TOPIC`.
- The toast's **Details** opens the **Import report**: which stencils are guesses (one click picks another),
  which setting each connection came from, and what wasn't drawn or couldn't be read, and why. Ctrl+K "Import
  report" opens it again while the diagram is open.
- Everything is read on this device. Setting values are used only to find host names and are never kept. With
  **New diagrams are private** on, the import is private; otherwise the report offers **Make it private**.
- Kubernetes manifests, AsyncAPI documents and Terraform plans are recognised, and say they can't be imported
  yet.
- New stencil: **MySQL** (MariaDB too).

## UX review, round 13 (2026-10)

Two habits change:

- **Double-click quick-add opens the new node's name.** Pick a stencil and type: the words name the node, as after
  Alt+arrow, the "+" and a dropped connection. They used to reach the canvas, where a T added a text and an L went
  live. One Ctrl+Z takes the node, its connection and their names, however long you take to type them (also after
  Alt+arrow, the "+", a dropped connection, or a rail or Ctrl+K add named with Enter straight after).
- **Shift+drag on empty canvas adds to the selection**, as Shift+click does. A plain drag still replaces it.

Also:

- An Undo toast ("Payments service left AKS · Undo") goes as soon as Ctrl+Z or the canvas's Undo runs, since its
  button would then reverse a different change.
- Esc clears the selection and keeps keyboard focus on the node, so Tab carries on from there; Esc never selects.
- Ctrl+K finds **Present**. Presenting puts keyboard focus on the canvas.
- In the AI panel, Advanced and the on-device box no longer squeeze the conversation: past 60% of the panel, they
  scroll.
- The shortcuts sheet lists the File keys (Ctrl+O, Ctrl+S, Ctrl+Shift+S) and slow motion's ← →.

## Private diagrams (2026-10)

No habit changes unless you use it. New:

- **File ▸ Privacy ▸ Private diagram** keeps a diagram on this device: no share links or embed codes, no saves to
  Google Drive, OneDrive or Dropbox, and no AI (the page's tools, Copy for AI and copied prompts are off). A
  **Private** lock sits beside its title; click it to read what that means or to make it not private again.
  Saving and exporting to this device work as before, and an exported file stays private when it's opened again.
- **File ▸ Privacy ▸ New diagrams are private** makes everything you start, import or open from this device
  private.
- In a private diagram the AI panel can allow Chrome's on-device model, which runs on this device.

## Structure and bulk (2026-10)

Three habits change:

- **Boundaries keep up.** A node belongs to the boundary around its centre, as before, but you now see it while you
  drag: the boundary it will be in lights up, and one it's leaving shows dashed. Drop a member so it pokes out of
  its boundary and the boundary grows to hold it; it used to stay the same size, and a node dragged a little too
  far quietly left. Leaving now says so, with Undo. Resizing a boundary takes in the nodes now inside it and lets
  go of those outside. Boundaries never shrink by themselves: Fit to contents does that.
- **Tab moves between nodes.** The canvas is one stop in the page's Tab order. Inside it, Tab and Shift+Tab step
  through the nodes in reading order, selecting each one; past the last, Tab leaves the canvas. Tab used to visit
  every node and then every edge, in the order they were made. Edges are reached from a node with Ctrl+Alt+] and
  Ctrl+Alt+[, and Ctrl+Alt+arrows (⌃⌥ on a Mac) go to the nearest node that way.
- **Route from side and Route to side are one row**, Route ▸, on the edge's menu.

Also new:

- With several things selected, the inspector edits them together: the nodes' stencil, boundary and shared
  simulation settings, the edges' relationship and label, and the colour of annotations and boundaries. "Mixed"
  shows where they differ. Each change is one undo step.
- Select similar (a node's or an edge's right-click, Ctrl+K) selects every node of that stencil, or every edge of
  that relationship.
- Tidy up (a selection's right-click, the inspector, Ctrl+K) lays out just the selected nodes by their connections,
  without moving anything else. Align and Distribute no longer stack nodes on top of each other.

## Flow building (2026-10)

One habit changes:

- **A rail click respects the selection.** With exactly one node selected, clicking a stencil in the rail adds
  it after that node, connected, as Ctrl+K's "Add …" already did. The rail's footer says so ("A click adds
  after Payments service"). With nothing selected, or several things, it adds an unconnected node in free
  space, as before. Drag the stencil instead to place it anywhere.

Also new:

- A selected node shows a "+": click it to pick the next node, which lands beside it, connected and ready to
  name. Alt+arrow does the same from the keyboard (→ and ↓ downstream, ← and ↑ upstream), and Alt+Shift+arrow
  adds a copy of the node there. On the canvas, Alt+← and Alt+→ no longer go back or forward in the browser.
- A new connected node's name editor has one more field: Tab, Tab names its connection.
- Drag either end of a selected edge onto another node to rewire it; it keeps its label and settings. From the
  keyboard, the edge's menu and Ctrl+K have Reconnect ▸ From / To.
- Hold a new node (or a stencil from the rail) over an edge for a moment and drop it to put it in between, or
  use Insert node on the edge's menu or in Ctrl+K.
- Dragging a stencil shows the node card it makes and an outline where it will land.
- Quick-add finds stencils the way the rail does: "pg" finds PostgreSQL, "go" the Go service.

## Drawing precision (2026-10)

Two habits change:

- **Esc saves a label instead of cancelling it.** In a node's label editor Esc used to throw the edit away; now
  it keeps it, as it already did for text and notes, and as Figma and tldraw do. Every text box on the canvas
  works the same way: Enter or Esc saves, Tab goes to the next field (label, then subtitle). Changed your mind?
  Ctrl+Z (⌘Z on a Mac) right after takes the edit back.
- **Snap to grid is now Snapping, and the arrow keys stay on the grid.** Dragged nodes line up with their
  neighbours' edges and centres, and with equal gaps, as well as with the grid. Hold Ctrl (⌘ on a Mac) while
  dragging to place something freely. An arrow key moves the selection to the next 10 px grid line and
  Shift+arrow moves it 50 px; they used to move 1 px and 10 px, which they still do with Snapping turned off
  (Show ▸ Snapping).

Also new:

- Enter edits the selected node, edge, boundary or annotation (F2 still works).
- Label editors stay readable when you're zoomed out.
- Ctrl+K opens at once, and what you type straight after it goes into its search.

## Drawing basics (2026-10)

Two habits change, to work like Figma, tldraw, Excalidraw and draw.io:

- **The wheel pans; Ctrl/⌘+wheel zooms.** A two-finger swipe moves the canvas in both directions, a pinch
  zooms, and Shift+wheel pans sideways on a mouse. Mouse users who zoomed with the wheel now hold Ctrl (⌘ on a
  Mac). Space+drag and the middle button pan from anywhere, even starting on a node.
- **A drag on empty canvas draws a selection box** (it picks what it touches; hold Ctrl/⌘ for only what's
  inside). Shift+click now adds to the selection, like Ctrl/⌘+click. Live view, presentation and embeds still
  pan with a drag, and an embed still lets the wheel scroll its page.

Also new:

- Drop a connection on empty canvas to pick the next node: it lands there, connected, ready to name.
- A connection dropped anywhere on a node connects to it; the node lights up first, and handles are easy to
  hit at any zoom.
- Ctrl+D, Ctrl+V and Alt+drag never put a copy on top of anything. Ctrl+V pastes at the pointer.
- Shift+2 zooms to the selection (also in Ctrl+K).
