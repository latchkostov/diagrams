## Gallery cleanup: retired and merged examples, a Full systems theme (2026-10-18)

The owner's gallery decisions from the large-showcase batch. The gallery now has 28 examples, led by a new
**Full systems** theme with the five large ones, and `black-friday-commerce` replaces `aws-serverless-orders` on the
start card.

- **Retired, with redirects.** `multi-region-active-active` (its failover story is `cell-based-bookings`' region
  evacuation), `iot-telemetry` (merged into `ev-charging-network`), `aws-fanout` (merged into `aws-serverless-orders`),
  and `autoscaling-image-workers` and `keda-render-workers` (combined as **Autoscaling basics**, one story each).
  `src/examples/retired.ts` maps each slug and its saved simulation ids to the replacement. The entry rewrites a
  retired `?example=` and `sim` before anything reads the address, so old links, shared and embedded URLs keep
  working. A remembered last canvas reopens as the replacement. Edits saved under a retired slug (example
  autosaves from before copies existed) become one of your diagrams at startup. Tabs adopt one at a time under a Web Lock, and the old key is removed only once Your diagrams lists the copy and it reads back the same edits (without Web Locks, the old key is always kept). A copy whose library entry was never published, after an interrupted start, gets its entry, Private when the edits were Private (and the source is kept until the copy is at least as private); a copy this run didn’t write is never rolled back, and a copy you deleted isn’t recreated. If storage is full, the edits stay under the old key and one error notice offers every one of them as a .diagram.json download. The copy’s slug is derived from the edits, so a retry finds the same entry, and adoption runs after the storage lifecycle starts.
- **Merged content.** `aws-serverless-orders` gains the fan-out's archive queue (with its DLQ and redrive), a
  scheduled reconciliation, and a third story, _Fulfillment Lambda is throttled_. `ev-charging-network` gains the IoT
  example's hot-partition story (_One partition runs hot_, 63 of 64 idle replicas until the key spreads over 32
  partitions), a technician email after field service, a fleet dashboard over the twins, and 7-day retention.
- **No unexplained findings.** `azure-service-bus-integration` gives both subscriptions their own dead-letter queue,
  read by a triage step. The commands DLQ stays for operator replay, as its label says, and the file now ignores
  its no-reader finding with that reason. So _Poison invoices_ still quarantines all 30 commands there, and a
  dead-lettered trace still ends at the DLQ.
  `notification-fanout` gives each channel a DLQ read by triage, with a managed identity for the senders.
  `rag-assistant` dead-letters failed ingest jobs to a triage worker. All three pass the checks with no findings (Azure's one ignore carries its reason).
- **#167 review fixes.**
  - Narration close-ups: every note's focus in the large examples now renders at 60% zoom or more on a desktop,
    and on a phone the note pans its cards into view. The cells' region notes split per region.
  - EV charging: driver sessions keep their `StartSession` type on the database branch, so they reach billing,
    Stripe and the roaming hub. Firmware commands carry `UpdateFirmware`, so a dead-lettered one is retried by
    the campaign.
  - New tests: a browser test that each large story's note brings its cards into view, clear of the note and the
    playback bar, at desktop and phone sizes. Another tells the partition-ceiling story apart from the dinner rush.
- **i18n.** One new message, `examples.themeSystems` ("Full systems"), translated in all 37 languages and stamped.

### Tests

- New unit tests:
  - `src/examples/retired.test.ts`: every retired slug and story maps to a current one, and the address rewrite
    keeps other parameters.
  - `diagramIO.test.ts`: adopting retired edits, once, and keeping them when storage is full.
  - Close-up readability, EV sessions and firmware retry, and the dispatch story difference in
    `largeShowcases.test.ts`.
  - The EV hot-spot capacity view.
- New e2e tests in `examples-picker.spec.ts`: a retired link opens its replacement in the mapped story; a remembered
  retired canvas reopens as the replacement; retired edits appear in Your diagrams; and the start card features the
  Black Friday platform.
- Tests that used a retired example as a fixture now use its replacement with the same assertions:
  - palette, stencils, fit-settled, AI panel, AI on-device, gallery, the browser parity settle run and the
    legacy-autosave test use `aws-serverless-orders` (fit-settled now checks the refitted boundary against its
    measured members, since this example's widest cards follow the platform's fonts);
  - the browser parity selection run, which needs an example where Auto-layout moves all but one node, uses
    `nightly-batch-elt`: `rag-assistant`'s new triage path changed its layering;
  - the capacity hot-spot spec uses `ev-charging-network`;
  - the deliberate-outage, flaky-writes and custom-throughput specs use `cell-based-bookings`;
  - the KEDA and HPA specs and engine tests use `autoscaling-basics`.
- Three diagrams are frozen where a test pins their exact behaviour:
  - `src/test/fixtures/legacy-iot-telemetry.json` keeps the legacy (v1) capacity wording covered;
  - `tests/parity/corpus/a1-image-workers` and `a2-render-workers` keep the frozen A1/A2 controller runs.
  - `tests/fixtures/checks/service-bus-missing-dlq.diagram.json` is the Azure example before its subscriptions got
    DLQs: exactly one warning (ledger-posting has no DLQ) and two suggestions. The Checks card, `check_diagram` and
    the image-export marker specs import it, since no public example keeps an unexplained finding. The
    suggestions-only count spec uses `outbox-saga-checkout`, now that `rag-assistant` has none.
- Exact counts updated:
  - the P2 legacy-precision table: 14 legacy examples, down from 17;
  - the invoices-without-a-DLQ spec now has 1 warning: the subscriptions' DLQs removed the other.

### Parity

`pnpm parity:update` reported 2,290 goldens: **84 added, 162 changed, 180 removed**, 0 missing. Every change is in
an example this batch adds, removes or edits, plus three shared goldens:

- **Removed (180):** every per-diagram golden of the five retired examples, including their browser render and layout:
  - simulation, checks, checks-words, evidence, planning, planning-p2, layout, routes, trace, exports
    (native, draw.io, Mermaid, HTML), agent describe/check/edit, and skill validate/scripts;
  - the A1/A2 controller runs keyed by their example slugs.
- **Added (84):**
  - the same per-diagram goldens for `autoscaling-basics`;
  - for the frozen corpus inputs `corpus-a1-image-workers` and `corpus-a2-render-workers`, including their A1/A2
    controller runs (`node/autoscaling/a1-image-workers`, `a2-render-workers`; the same frozen diagrams and runs
    as before, under the corpus names);
  - the new stories of `aws-serverless-orders` (throttle) and `ev-charging-network` (hot-spot).
- **Changed, per example:**
  - `aws-serverless-orders`, `azure-service-bus-integration`, `notification-fanout`, `rag-assistant` and
    `ev-charging-network` (new nodes, connections and stories) change in every area, including browser render
    and layout;
  - `black-friday-commerce`, `cell-based-bookings` and `delivery-dispatch` change only in their narration notes
    (focus lists and the cells' split region notes): simulation markers, agent describe/edit, exports and skill
    share links.
- **Changed, shared:**
  - `node/i18n/catalogs.json`: one more message in every catalog and a new examples area hash.
  - `node/skill/current-stencils.json` and `node/skill/files.json`: the regenerated stencil reference's
    most-used ranking.
  - `node/skill/validate.txt`: the original-cohort transcript no longer lists the retired examples.
- **Later round (29 changed, 0 added, 0 removed):** the Azure commands DLQ went back to operator replay with an
  explained ignore. Only the Azure example's own goldens change (simulation, trace, checks, agent, exports, layout,
  routes, browser render and layout), plus its line in `node/skill/validate.txt` (18 connections, not 19).
