## CPU ownership after a paused scale transition (R4 follow-up)

Enabling the full CPU/resource oracle in the ledger command model finds an existing
`resource-backed thread tail has no CPU ownership` failure at 120 ms. It reproduces with
both the recovery fix and the prior branch head `9000ae15bf350ef4c08c77c3f96d9e8734c30a8b`.
This is separate from admission occupancy; the command model now checks its admission oracle
every tick, while the existing resource fuzzers retain the complete CPU/resource oracle.

Reproduction: `FC_RUN_MULTIPLIER=5 FC_SEED=20261019` and
`FC_PATH=140:0:0:0:1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:11`,
`pnpm exec vitest run src/sim/ledger.commands.test.ts -t 'scaleOne=false'`, with
`verifyResources: assertResourceInvariants` in `probe`. The reduced graph has two generic service
tiers, zero latency/CPU at the first tier, a blocking request, and a pause followed by scale
1 to 1.01 and more traffic. Repair and pin its CPU ownership in the execution-resource round;
do not weaken the oracle or alter parity tolerances.
