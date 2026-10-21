# Live Diagrams

Draw architecture and event-driven system diagrams with live message-flow simulations as offline interactive HTML files, editable diagram files, or share links.

Live Diagrams turns a system description into a diagram you can inspect, edit and replay. Show traffic,
outages, retries and dead-letter queues without connecting to a real system. The plugin includes one
skill and its local Node.js scripts. No account, API key, package install or browser automation is needed;
the scripts require Node.js 20 or later and use its standard library.

## Install and use

The repository marketplace is available now. In Claude Code, run:

```text
/plugin marketplace add latchkostov/diagrams
/plugin install livediagrams@livediagrams
```

Ask for a diagram, or invoke `/livediagrams:livediagrams` with your request. For example:

- Draw an order service publishing events to a queue, two workers and a database. Return an editable diagram file.
- Diagram a generic event pipeline with retries and a dead-letter queue. Return an offline interactive HTML file.
- Show a worker outage and recovery in a live simulation. Return an interactive HTML file with a banner.

Claude's plugin directory listing is coming soon, subject to approval. The separate skill ZIP at
<https://www.livediagrams.dev/skill/> remains available for manual installation in compatible agents.

## What runs and where data goes

`SKILL.md` guides the agent to write a `.diagram.json` file, then run `scripts/layout.mjs` and
`scripts/validate.mjs`. `scripts/export-html.mjs` creates a self-contained interactive HTML file and
can encrypt it with a password entered in the user's terminal. `scripts/share-link.mjs` only prints
a URL when a share link is requested, and refuses diagrams marked private. No script uploads, fetches,
calls another service, collects personal data or sends telemetry. There are no connectors, hooks or
background services. Diagrams and exports are files in the user's environment; delete them there when
no longer needed. The plugin operates on the files the user supplies, so avoid personal data and secrets
in diagram content. The agent platform's handling of conversations and files is separate.

Share links carry the diagram in the URL fragment (`#d=…`). Opening one requests the Live Diagrams
website and its assets over HTTPS; the host receives ordinary request metadata such as the viewer's
IP address, but the browser does not send the fragment in that HTTP request. The app decodes the diagram
in the browser, removes the fragment from the address bar and keeps a shared copy in that browser's
storage. Anyone with the full link can read it. This optional website visit differs from the offline
HTML export, whose content security policy blocks network connections. The plugin itself has no
server, collection or retention service, and is not intended for people under 18.

The bundled viewer, icons, validator and layout code are generated from the public repository's sources
and committed so installations work without a build. Some bundles exceed the directory's inspection
threshold; they may require manual review. They contain code and assets, not remote dependencies.

## Troubleshooting and support

Check `node --version` if a script cannot start. Run `node scripts/validate.mjs <file.diagram.json>`
from this folder to explain invalid diagram content. Run `node scripts/layout.mjs <file.diagram.json>`
if coordinates are missing. Long share links can be truncated by messaging tools; use a file instead.
Report product issues at <https://github.com/latchkostov/diagrams/issues>. For security concerns,
contact the publisher through the directory listing; keep credentials and sensitive diagrams out of
public issue reports.

## Releases

The plugin is deliberately **unversioned**: `plugin.json` and the marketplace entry carry no `version`, so
Claude Code and the directory track the git commit on `master`, and every merged change reaches users.
Don't add a version; a fixed one pins cached installs until it is bumped, and the repository forbids
manual version bumps. Recommend GitHub push webhook updates in the directory. The download contains only `SKILL.md`, `reference/` and `scripts/`; this README, licence,
manifest and listing icon are plugin packaging, excluded from the skill ZIP.

Licensed under MIT; see [LICENSE](LICENSE).
