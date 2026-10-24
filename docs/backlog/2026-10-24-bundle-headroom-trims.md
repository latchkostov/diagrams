## Schedule bundle headroom trims

The fixed startup, canvasFirstView and liveSession budgets are within limits but below the approved
8,192 B warning floor. Schedule dedicated trim PRs, with one owner per surface, using the registered
lazy primitive and hold-the-chunk contracts. Keep limits fixed and parity unchanged. Feature PRs
should report their merge-base deltas without unrelated trims. Resolve this entry when scheduled
trims restore the warning floor across all three budgets.

Trim 2 restores canvasFirstView to 374,563 / 383,000 B (8,437 B headroom), with the additional
Live download at 126,245 / 135,000 B (8,755 B headroom). Startup remains at 173,493 / 177,000 B
(3,507 B headroom); keep this entry open for a dedicated startup trim.
