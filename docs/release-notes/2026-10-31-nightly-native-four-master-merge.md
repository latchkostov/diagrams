## Anchored coach integration in nightly browser repairs

Merge master #408 into #409 while keeping the pointer tutorial driver in its shared helper.
Highlights-off checks now assert that the target ring (`tutorial-spot`) is absent; the anchored
instruction card can remain visible. Keep master's keycap, RTL card, compact-sheet and coach-target
assertions together with the branch's native input handoffs and partitioned tutorial sweeps.

## Output parity

The merge imports master's existing `tests/parity/goldens/node/i18n/catalogs.json` unchanged.
Compared with this branch's previous head, its message counts increase from 4,543 to 4,578,
translated catalogs gain 35 English fallbacks, and tutorials-area fingerprints change for the
anchored coach copy, including the pseudo-locale. No other golden changes. The merge resolution
does not re-record any golden or introduce further output changes.
