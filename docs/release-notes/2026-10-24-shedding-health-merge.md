## Shedding and current health

Merge the current-health changes into load shedding. Recent shedding refusals use the same
10-second simulation-time health window as other failures and refusals, including its pause,
restart and seek behavior. Admission refusals exclude shedding so each refusal is explained once.
The cumulative ⤓ chip remains; hover and Inspector shedding totals live in Outcomes under
**Since restart**, alongside the other past outcomes. Calls keeps the current queue depth and limit.

The retry-storm example retains all four early, non-blocking comparison narrations and the
load-shedding simulation. Shedding remains in the cumulative, replay-proven fix ladder.
Generated skill conflicts were resolved from master and refreshed with `pnpm regen`.

## Re-recorded goldens

`node scripts/parity.mjs --tier node --update` re-records only these seven conflicted files
relative to the automatically merged tree (using master's versions for conflicted goldens).
Paths below are relative to `tests/parity/goldens/`:

| Golden                                      | Reason                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `node/agent/describe/retry-storm.json`      | Description and fingerprint combine master's narration with the shedding simulation. |
| `node/exports/drawio-meta/retry-storm.json` | Metadata round-trip includes both narration and shedding.                            |
| `node/exports/drawio/retry-storm.drawio`    | Embedded native payload includes both changes.                                       |
| `node/exports/html/retry-storm.dark.json`   | Dark HTML payload, size and fingerprints include the combined example.               |
| `node/exports/html/retry-storm.light.json`  | Light HTML payload, size and fingerprints include the combined example.              |
| `node/i18n/catalogs.json`                   | Catalog fingerprints combine the English health and shedding keys.                   |
| `node/skill/scripts/retry-storm.json`       | Skill export/share payloads and fingerprints include the combined example.           |

The narration and native/agent-edit goldens that merged automatically need no re-recording.
No simulation counters or unrelated goldens are re-recorded by this merge resolution.
