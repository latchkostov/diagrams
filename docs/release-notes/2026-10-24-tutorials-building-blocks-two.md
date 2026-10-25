## Building blocks tutorials from public examples

Added five tutorials in the existing development/E2E Tutorials view: webhooks,
notification fanout, partitions, outbox sagas and Config settings. Each opens a fresh
sandbox from its public example, uses the saved simulations' seeds, and follows the
example's own narration and expectations.

Skip now runs demos on sticky steps before recording completion. The new trace demo
uses the existing Trace a message → Next message registry action and waits for the
Live session to load. Edge targets resolve from endpoint subjects rather than saved
edge IDs. Settings demos preserve existing entries.

The SMS outage lesson watches queue lag: that public simulation pauses its sender
and does not dead-letter messages. The outbox lesson starts tracing in Free play,
then explicitly runs the happy path before declines; auto-starting the happy path
would already arm a trace and bypass the trace lesson. The Config lesson adds a fifth
setting because its example already has four.
The partitions lesson distinguishes the learner's edit to six from the saved
comparison's own setup, which applies eight partitions.

The only intentional parity change is `node/i18n/catalogs.json`: 58 new tutorial
messages increase message and English-fallback counts by 58 and change the tutorials-area
hash for each language. Simulation, rendering, export and all other goldens are unchanged.
