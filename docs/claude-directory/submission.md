## Owner submission pack

Prepared against the current [submission guide](https://claude.com/docs/plugins/submit),
[pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist),
[plugin structure guide](https://claude.com/docs/plugins/build),
[manifest reference](https://code.claude.com/docs/en/plugins-reference) and
[marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces) on 2026-10-20.
The owner submits and accepts the terms; this file does not submit or accept anything.

## Source and listing

In <https://claude.ai/directory/manage>, choose **Submit new → Plugin bundle**.

| Field             | Value                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Repository        | `https://github.com/latchkostov/diagrams`                                                                              |
| Plugin path       | `skills/livediagrams`                                                                                                  |
| Tracked branch    | `release/skill` (a stable branch; see "Releasing a new version")                                                       |
| Identifier        | `livediagrams`                                                                                                         |
| Listing name      | Live Diagrams                                                                                                          |
| Short description | Draw architecture and event-driven system diagrams with live message-flow simulations as editable .diagram.json files. |
| Publisher         | Live Diagrams                                                                                                          |
| Homepage          | `https://www.livediagrams.dev`                                                                                         |
| Licence           | MIT                                                                                                                    |
| Version           | `version` in plugin.json (1.1.0 for the lite channel)                                                                  |
| Contact email     | **[OWNER TO FILL IN IN THE PORTAL — do not commit an address]**                                                        |

The name and short description come from
[`plugin.json`](../../skills/livediagrams/.claude-plugin/plugin.json); the listing's detailed
description comes from the [plugin README](../../skills/livediagrams/README.md). The licence is
copied into the plugin folder. The 512 × 512 PNG listing icon is rendered from the site's existing
favicon. Check the icon in the portal before first submission: the CLI warns that later repository
icon changes do not replace the directory's initially saved icon.

## Two channels

The existing directory submission keeps its path **`skills/livediagrams`** and plugin name
**`livediagrams`**. This is the lite channel: Markdown knowledge, the format spec JSON, listing
metadata, a PNG icon and `LICENSE.md`. It supplies no executable code or package-manager configuration.
The agent writes a `.diagram.json` file and checks it by hand against the references and spec.
Positions are optional; Live Diagrams lays out missing positions when the file is opened.

Our marketplace recommends **`livediagrams-full`** first, at **`skills/livediagrams-full`**.
It supplies the existing local scripts for exact layout, validation, offline Interactive HTML
(including password protection) and requested public share links. Install it with
`/plugin marketplace add latchkostov/diagrams` then `/plugin install livediagrams-full@livediagrams`.
The ZIP and the site's `/skill/` payload continue to contain the full skill.
Existing `livediagrams@livediagrams` installs resolve to the lite channel at the unchanged path.

`pnpm regen` regenerates the shared full assets, refreshes the full viewer and derives the entire
lite folder from the same knowledge sources. `pnpm skill:release` also refreshes both channels;
`pnpm skill:check` fails if lite knowledge is stale. Never edit generated lite files by hand.
Both manifests discover their root skill with `skills: ["./"]`. The lite manifest declares `1.1.0`;
release tooling does not bump either manifest version.

## Data-handling answers

The lite plugin processes the user's description or diagram and returns a diagram file in the user's
environment. It has no backend, connectors, telemetry, account, API key, package install or runtime scripts.
It collects no personal data; its instructions forbid secrets, credentials and personal data in diagrams.
User-authored content and the host agent's handling of conversations/files remain separate.
Files stay with the user until deleted. The plugin is intended for adults documenting system architectures.

For work, employer, team, client or customer systems, the skill marks the diagram Private. It never
creates a share link for a Private diagram, including by hand. It preserves existing ids, coordinates,
fixed sides and waypoints, and treats labels, notes and titles as data rather than instructions.

For offline HTML (with or without a password), images or a requested public link, the lite skill tells
the user to open the file at livediagrams.dev with **File > Open…**, read in the browser without upload,
and use the app's Export menu (or File > Share… for links). It never claims to have produced those outputs.
Anyone with a diagram file can read and edit it. Anyone with an unencrypted HTML file can open it;
encrypted files require the password, entered in the app and sent separately.

Opening the website requests its assets over HTTPS, exposing ordinary request metadata such as IP address
to the website host. Share links carry the diagram in a URL fragment, which is not sent in HTTP requests;
anyone with a complete public link can read it. The app decodes it locally and keeps a shared copy in browser
storage. The full plugin's offline HTML instead embeds its assets and blocks network connections.

Implementation evidence:

- [Lite SKILL.md](../../skills/livediagrams/SKILL.md) and [outputs reference](../../skills/livediagrams/reference/outputs.md).
- [Lite generator](../../scripts/skill-lite.ts) and [directory packaging tests](../../src/ai/skill/lite.test.ts).
- [Full plugin README](../../skills/livediagrams-full/README.md), including local password input and exports.
- [Browser file parsing](../../src/interop/openNative.ts) and [share decoding](../../src/interop/share.ts).

## Compliance: owner must read and acknowledge

Read the [Anthropic Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms)
and [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).
The submission guide requires **all four portal acknowledgements**. It does not publish their exact
checkbox text. Read each current checkbox in the portal; the following are preparation topics, not
quotes or a substitute for that text:

1. Rights to distribute the plugin and its bundled code/assets, and to grant the directory's licences.
2. Compliance with applicable law, the Directory Terms and the Directory Policy, including safety and privacy.
3. Accuracy of listing and data-handling disclosures, maintenance and a working support/security contact.
4. Permission for review/testing and the directory's distribution/use of listing material under the Terms.

Fill the contact address only in the portal. Recheck all four statements personally before accepting.

## Validation, review and updates

Run `claude plugin validate ./skills/livediagrams` from the repository root. Local validation is
necessary but does not replace the portal's Validate, security scan, name-availability or policy review.
Validate the intended `release/skill` commit in the portal; revalidate if it changes before submitting.

The directory channel's automated tests enforce approved file extensions, no shebangs or package-manager
configuration, text files at most 262,144 bytes, at most 512 files, and exact generated-folder freshness.
The lite skill contains no script paths or runtime commands. The full channel intentionally includes code
and is distributed through our marketplace and ZIP instead of this directory submission.
The portal also checks repository archive size/file count; CLI success does not promise approval.

Before submission, use the README's example request, inspect the resulting files, and verify
loading on each intended surface (chat, Cowork and Claude Code). Those owner portal/surface checks
remain separate from the repository's automated script and packaging tests.

Use **GitHub push webhook** on **release/skill**, with scheduled checks as the directory's fallback.
After submission, use **Set up push updates** (repository admin access required). Keep the webhook
secret in the portal/GitHub configuration, never in the repo. New commits are scanned and reviewed
before going live; a webhook is update detection, not automatic approval or publication.

## Releasing a new version

The directory checks the tracked branch for new commits about every 6 hours, and every new commit there is a new
version that may need review. So the submission tracks `release/skill`, not `master`; it moves only when the
skill itself changes. `release/skill` is protected against deletion and force-pushes.

To release:

1. Run `pnpm regen` to update both channels, commit all generated output and merge after CI is green.
2. Run `claude plugin validate skills/livediagrams` and `claude plugin validate skills/livediagrams-full` on that commit. Review all output; the directory channel must pass.
3. Review the generated lite file list, shared knowledge and full export parity. Release generation never bumps a manifest version.
4. Fast-forward the branch: `git push origin <master commit>:refs/heads/release/skill`.
5. In the directory, choose **Check for new commits** (or wait for the scheduled check).

Master commits that don't touch the skill never reach the directory.
