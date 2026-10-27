## Numbered findings

Checks opens its first finding and shows one full row at a time. Closed rows show the title and first sentence, with no element chips or fix controls. Numbers stay tied to the complete warnings-then-suggestions list, including while filtered.

Only the selected finding gets numbered canvas tags. Every element folds its other findings into one outlined count badge. Clicking a count filters Checks to that element; completing its last fix clears that filter. Tags and count badges hold their screen size and keep their contrast in both themes.

## Compatibility and output

Existing row, selection, fix, choice, Why, element and More controls retain their test IDs. Per-element marker IDs still identify the marker group; selected tags use check-marker and aggregate buttons use check-count-<id>. Controls on a closed row become available by opening that row. Actual check severity and list ordering are preserved rather than changed to imitate mockup data.

No goldens changed. Rendered Checks layouts remain reserved for the planned step 12 golden review.

## Pending parity review

No golden file was edited. The Node check reports 1,864 passing and nine failing tests, covering ten intended output differences that remain for step 12:

- `node/agent/describe/retry-storm.json`: the public example's description now explains how to watch the run chart.
- `node/agent/edit/retry-storm.json`: the same description is preserved in the edited diagram.
- `node/skill/scripts/retry-storm.json`: the serialized diagram and its share-link fingerprint include that description.
- `node/exports/native/retry-storm.diagram.json`: the native export carries the updated description.
- `node/exports/drawio/retry-storm.drawio`: draw.io carries the updated description and embedded diagram.
- `node/exports/drawio-meta/retry-storm.json`: the draw.io fingerprints change with that embedded metadata.
- `node/exports/mermaid/retry-storm.mmd`: its description comment changes.
- `node/exports/html/retry-storm.light.json` and `node/exports/html/retry-storm.dark.json`: embedded diagram metadata changes both HTML fingerprints.
- `node/i18n/catalogs.json`: the Workbench messages, translated lesson directions and merged Tutorials catalogs change catalog counts and hashes.

Simulation output goldens remain unchanged. The earlier full parity run also reports rendered redesign differences; the build spec assigns recording those to step 12.
