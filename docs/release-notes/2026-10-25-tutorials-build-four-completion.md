## Building-block tutorials use the shared completion contract

Ported the gateway, Kafka topic, queue workers, load balancer and cache-aside lessons onto the tutorial runtime
from master, including PR #318. Their demos declare edits and traffic controls; naming settlement and Show me
use the shared runner. Queue totals and cache comparisons use metric expressions. The load-balancer watch
counts ten additional requests after its step opens.

All 154 completion-sweep cases for these five lessons pass, including selection and extra-node perturbations.
The seeded-engine tests still require each watch goal within ten seconds of simulated traffic. Restoring the
old lesson checks temporarily makes three regression tests fail. The runtime contract is unchanged.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes relative to master: the five lessons add English
messages, update tutorial namespace fingerprints and increase missing-translation fallback counts. No other
golden changes. Generated skill assets were refreshed. Canvas-first-view headroom is 19,190 B.
