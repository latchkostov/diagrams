## Owner decisions: Live, rooms, export and tutorial controls

- Double-clicking a node in Live opens Properties without selecting its name. Editing still opens
  the selected name. The editor-mode machine chooses the intent and the interaction controller
  executes it. Focus requests remain monotonic across editing → Live → editing.
- With no collaboration servers configured, the failed room chip offers an explanation and the
  existing self-hosting guide instead of Retry (TC-72). Configured rooms retain Retry.
- Recordings capture Live narration; SVG exports omit it (LL-04). The SVG format option's tooltip
  and accessible description, plus the export docs, explain this. The parked test is now an enabled
  absence assertion and the backlog decision is marked DECIDED.
- The inline rate limiter has a Rate limit field in the Inspector's Simulation section, including
  units, validation, clearing and Undo. It edits the existing local request quota while retaining
  other budgets and API settings. The field stays behind the lazy Inspector chunk.
- Add a consumer retains its generic action target and adds `trouble-add-consumer` for tutorials.

The new public **An inline request rate limit** example sends 20 requests/s through a 10 requests/s
limiter and shows rejections within ten seconds. Its generated `rateLimits` tag is tested. The Lab
also exposes it for preview. The tutorial's split/choreography remains in its own lane.

## Output parity

Two existing fingerprints intentionally change:

- `node/i18n/catalogs.json`: five English messages are added for room docs, SVG help, the Rate limit
  label and units, and the example summary. The double-click help uses a new key for its changed
  meaning; untranslated messages use English fallback. Catalog hashes/counts change accordingly.
- `node/skill/current-stencils.json`: the new example changes usage ranking in the generated stencil
  reference. Public contracts and schemas are unchanged.

Twenty-seven new goldens describe only `inline-rate-limit`:

- Agent describe/check/edit, Checks data/words, planning/P2 planning, Node layout/routes, free-play
  simulation, trace JSON/Mermaid, and skill validation/scripts record the new three-node diagram.
- Native/native metadata, draw.io/draw.io metadata, Mermaid/plain Mermaid/readback, and light/dark
  Interactive HTML plus their metadata record its export formats.
- Browser render and layout record measured geometry, Auto-layout and Tidy.

No existing diagram-output golden changes. An always-visible export-help paragraph was rejected
because moving the dialog exposed hover paint in image exports; the format hint preserves the
dialog's geometry. Unexpected image differences were investigated rather than re-recorded.

## Verification

Targeted unit tests pass (173), including the startup chunk contract. Seven production-build browser
regressions pass. The affected Inspector specs and their neighbours pass five Linux repeats under
six-worker/six-CPU load: 350 passed, zero failed/flaky. Deliberate regressions were rejected for all
five decisions and for the focus-sequence edge case. Lint, typecheck, formatting, build, size and
i18n checks pass; PR CI remains the full gate.

The first parity run reported the intended catalog/showcase differences and an export-help layout
regression, then encountered a dependency-cache setup error. The help placement and cache isolation
were corrected. Targeted Node parity checks pass (76 catalog/skill tests and 15 showcase tests),
and all 110 Linux browser parity cases pass against the reviewed goldens. The clean-master dark
PNG check also passed twice; no pre-existing-failure exception or assertion change was used.

Canvas first-view gzip is 364,422 / 383,000 B, retaining 18,578 B headroom. Entry gzip is 108.1 kB
against 123.5 kB. Live's existing low-headroom warning is tracked in a separate backlog fragment.
