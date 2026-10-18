## Slow motion absorbs pending camera work (2026-10-18)

Starting slow motion folds an older pending panel refit into one take for the settled pane. It
cannot recentre the view behind the replay, wait on an old menu, or run again after settling.
An idle start keeps the existing take lifecycle; later pane changes keep the existing slow-motion rules.

Property tests now use a shared fixed CI seed, with `FC_SEED` and `FC_PATH` for reproduction.
Local runs remain random. Nightly explores random seeds with twenty times the usual property runs.
Every failing seed is retained as a fixed regression. See `docs/QUALITY.md` for replay commands.

Output parity is unchanged: no golden is updated.
