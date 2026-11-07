# Live Diagrams

Draw architecture and event-driven system diagrams with live message-flow simulations as editable .diagram.json files.

This script-free directory plugin writes diagram files and checks them by hand against the shared format and stencil references. The app lays out missing positions when you open the file. No account, API key or upload is required.

## Install and use

Install from the Claude directory, or use `/plugin marketplace add latchkostov/diagrams` then `/plugin install livediagrams@livediagrams`. Ask for an event pipeline with a worker outage and recovery as an editable diagram file.

## Privacy and outputs

Open the file at livediagrams.dev with File > Open…; the browser reads it without uploading it. Use the app's Export menu for offline HTML or images and File > Share… for requested links. Anyone with a diagram file can read and edit it. Internal diagrams are marked Private; never include secrets, credentials or personal data. Files remain in your environment until you delete them. The agent platform handles conversations and files under its own policies. No connectors, hooks, telemetry or background services are supplied. This plugin is not intended for people under 18.

## Two channels and releases

Our marketplace recommends `livediagrams-full`, which adds one-step offline HTML export, exact layout and validation. The ZIP at https://www.livediagrams.dev/skill/ contains that full skill. Both channels share the same knowledge sources; `pnpm regen` or `pnpm skill:release` regenerates this entire folder. Never edit it by hand.

Report issues at https://github.com/latchkostov/diagrams/issues, without credentials or sensitive diagrams. Licensed under MIT; see [LICENSE.md](LICENSE.md).
