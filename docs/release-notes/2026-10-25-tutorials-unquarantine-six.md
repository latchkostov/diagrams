## Six tutorial lessons available again

Capacity, Trace in slow motion, Saved simulations, Scale to zero, Load shedding and Dead letters return to the tutorial catalog following the owner's October 25 decisions.

- Capacity explains the automatically appearing Bottleneck callout within Apply fix and retains app chrome so View → Show capacity is reachable (R-b860498552).
- Trace in slow motion ends when the journey finishes, without a Sequence diagram step.
- Saved simulations has a short, authored retry run with a real pausing note, Continue and an expectation. Its saved definition uses `saveSimulation` data through `withSavedSimulation`; continuing uses `continueNote`.
- Scale to zero reads `fleet.starting >= 1` during the morning rush as its cold-start signal.
- Load shedding uses Inject → 100, reads the backlog, edits Queue limit outside Live, then repeats the injection and checks both new shedding and bounded backlog. Its seed stays interactive while the learner reads.
- Dead letters retains the poison run, dead-letter observation and Max deliveries edit, followed by acknowledged narration about replay. The editor does not resend dead letters.

Changed lesson meanings use version 2 so old progress cannot skip newly authored steps. The remaining quarantines stay in place. No runner or bundle-limit changes.

## Validation and output parity

Targeted catalog/unit tests and all six completion contracts, including selection perturbations, pass. Regression tests reject the original lesson definitions. Production play-throughs also cover Skip-all without saving a diagram. The completion harness now uses the real capacity calculation and saved-run fix; its independent landing probe restores saved progress before the resume case.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: all 37 translated catalogs gain 20 English-fallback messages (3,846 → 3,866 messages), with fallback counts increasing by 20 and only the tutorials-area hashes changing. The other two i18n goldens remain identical. No simulation golden is re-recorded.
