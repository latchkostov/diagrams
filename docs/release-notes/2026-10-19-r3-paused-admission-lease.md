## Callers release capacity and recover after live reductions

Resuming a caller after lowering its capacity now returns the unused part of its previously
admitted execution lease. Previously, a sampled arrival admitted while paused could start with
less execution weight than it had charged, leaving phantom occupancy even after completion.
Request residence keeps its independently admitted weight.

Seed 607376523 reduces to: pause, admit weight 1.5, lower capacity to one, resume. A named regression
covers both unchanged scale and a change to scale one, checks the separate request/thread weights,
and requires all leases to drain. Temporarily removing the fix fails both cases.

The wider sweep found seed 1475036957. Its reduced cases exposed two further problems: fractional
releases left round-off that made an empty one-slot pool unusable, and a continuation that lost
request admission during shutdown could block an admitted continuation that needed to finish
before releasing capacity. Releases now normalize numeric residue as pool releases already do;
unadmitted recovered continuations rejoin the admission queue, allowing admitted continuations
their existing priority. Both have named regressions that fail with their corrections removed.
R3's separate request and execution ownership model is unchanged.

`node scripts/fc-sweep.mjs --jobs 4 --seed -2104931721 --seed 607376523 --seed 1475036957` runs every command-model
test plus both waits review/sampling suites across 100 distinct fresh seeds at 5×, ten further fresh
seeds at 20×, and the three historical seeds at 5×. Reports preserve the seed list, elapsed time and
complete failure output, including fast-check shrink paths. Individual seeds can be replayed with
`--count 0 --heavy-count 0 --seed N`; file paths may be supplied to select other suites.

No parity goldens change. No timeout or invariant is weakened, and no quota transaction is repeated
when the already-admitted work starts.
