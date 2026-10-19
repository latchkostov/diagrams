## Live opens in Free play

Going Live now opens Free play on every diagram, including gallery examples with saved simulations.
Traffic runs immediately at the diagram's configured source rates, using the existing logged,
budget-checked traffic control. The Traffic toggle still pauses it. Saved simulations remain in the
picker, and the gallery's explicit **Run it** and simulation links still start the named simulation.

When a diagram has no traffic sources, the existing hint slot explains how to send a request or add
a source. Adding a source clears the hint. Explicit `traffic=0` links, click-to-play embeds, saved
runs, recordings, presentation, slow motion and Watch together retain their startup/state controls.

Output parity: only `tests/parity/goldens/node/i18n/catalogs.json` intentionally changes, recording
the new no-source hint: every catalog's message total increases by one, untranslated catalogs gain
one English fallback and a new `liveSession` area hash, and the generated pseudo-locale gains the
translated entry and its area hash. Diagram outputs are unchanged.
