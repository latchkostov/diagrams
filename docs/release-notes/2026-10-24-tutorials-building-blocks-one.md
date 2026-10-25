## Building blocks: five practice tutorials

The development and E2E Tutorials view now includes five Building blocks lessons:
route a mobile app through a gateway, give Kafka consumers separate groups, share
queue work, sketch cache traffic with message shares, and reduce a replicated service's
capacity while requests keep flowing. Each uses the existing quick-add, inspector and
Live controls in an unsaved practice diagram.

Naming waits for Enter or leaving the name field. Skip and near-miss corrections keep
the learner's existing node. Seeded simulations and observed counters verify the lessons;
the replica lesson counts ten additional requests after the reduction.

The cache sketch sets both independent shares (80% Redis, 20% PostgreSQL); it does not
simulate cache hits and misses. The replica lesson lowers three replicas to two because
Take down stops the whole node. The gateway lesson distributes traffic and links to
the address-routing example for a fuller model.

One parity golden changes: `node/i18n/catalogs.json` records 115 new English messages,
the resulting fallback counts, and the tutorial-area message hashes for each language.
The new lessons fall back to English until their translation batch. No simulation,
public-example, drawing or export goldens change.
