## Owner submission pack

Prepared against the current [submission guide](https://claude.com/docs/plugins/submit),
[pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist),
[plugin structure guide](https://claude.com/docs/plugins/build),
[manifest reference](https://code.claude.com/docs/en/plugins-reference) and
[marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces) on 2026-10-20.
The owner submits and accepts the terms; this file does not submit or accept anything.

## Source and listing

In <https://claude.ai/directory/manage>, choose **Submit new → Plugin bundle**.

| Field             | Value                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository        | `https://github.com/latchkostov/diagrams`                                                                                                                        |
| Plugin path       | `skills/livediagrams`                                                                                                                                            |
| Tracked branch    | `master` (after this change merges)                                                                                                                              |
| Identifier        | `livediagrams`                                                                                                                                                   |
| Listing name      | Live Diagrams                                                                                                                                                    |
| Short description | Draw architecture and event-driven system diagrams with live message-flow simulations as offline interactive HTML files, editable diagram files, or share links. |
| Publisher         | Live Diagrams                                                                                                                                                    |
| Homepage          | `https://www.livediagrams.dev`                                                                                                                                   |
| Licence           | MIT                                                                                                                                                              |
| Version           | None: unversioned, tracks the commit                                                                                                                             |
| Contact email     | **[OWNER TO FILL IN IN THE PORTAL — do not commit an address]**                                                                                                  |

The name and short description come from
[`plugin.json`](../../skills/livediagrams/.claude-plugin/plugin.json); the listing's detailed
description comes from the [plugin README](../../skills/livediagrams/README.md). The licence is
copied into the plugin folder. The 512 × 512 PNG listing icon is rendered from the site's existing
favicon. Check the icon in the portal before first submission: the CLI warns that later repository
icon changes do not replace the directory's initially saved icon.

## Layout and release choice

The manifest's `skills: ["./"]` discovers the existing root `SKILL.md`. The current manifest reference
explicitly accepts the plugin root and a skill directory containing `SKILL.md` directly. Claude Code
2.1.305 validates this layout. All scripts, references and viewer assets stay inside the plugin;
there are no symlinks or references to runtime files elsewhere in the repository.

Moving or duplicating the skill would add generator, sync and documentation churn. A second nested
skill would risk drift. Keeping it here preserves the marketplace source and both existing install
commands. The download reader includes only `SKILL.md`, `reference/` and `scripts/`, keeping plugin
metadata, README, licence and icon out of the ZIP and preserving its contents and size.

Follow the [README release policy](../../skills/livediagrams/README.md#releases): the plugin is unversioned,
so the directory and Claude Code track commits on `master`. Don't add a manifest version.

## Data-handling answers

| Portal question                                       | Recommended answer and scope                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal data read or stored?                         | None collected by the plugin. It processes user-provided diagram files and writes requested output files. It has no personal-data collection, telemetry or account system; the instructions forbid personal data and secrets in diagrams. Do not treat arbitrary user-authored content as guaranteed free of personal data. |
| Data sent to services other than declared connectors? | None by the skill itself; there are no connectors. All supplied scripts use local Node APIs. The optional share-link script only prints a URL, on request. Opening it is a separate website visit, described below.                                                                                                         |
| Retention?                                            | None by the plugin operator: no backend, remote storage or retention service. Files remain in the user's environment until they delete them. The host agent's conversations/files follow that platform's policies. A diagram opened on the website is also kept in the viewer's browser storage.                            |
| Intended for people under 18?                         | No. Intended for people documenting software architectures.                                                                                                                                                                                                                                                                 |
| Account or API key?                                   | Neither required by the skill or Live Diagrams. No test account is necessary; Node.js 20 or later is needed to run scripts.                                                                                                                                                                                                 |

Share links contain the complete diagram in `#d=…`, compressed and encoded, not encrypted.
Creating one does not contact livediagrams.dev. Opening one loads the website and its assets over
HTTPS, exposing normal request metadata (including the viewer's IP address) to the website host.
The fragment is not sent in the HTTP request. JavaScript decodes and validates it locally, removes
the fragment from the address bar/history entry and keeps the diagram in that browser's shared
storage slot. Anyone with the complete link can read it. Browser history, clipboard, messages or
extensions may retain copies of the full link. The offline HTML export instead embeds the diagram
and assets in one file and blocks network connections through its content security policy.

Verified implementation evidence:

- [`SKILL.md`](../../skills/livediagrams/SKILL.md): output choice, private diagrams, requested sharing and no personal data.
- [`share-link.mjs`](../../skills/livediagrams/scripts/share-link.mjs): local encoding, stdout only, refusal of private diagrams.
- [`export-html.mjs`](../../skills/livediagrams/scripts/export-html.mjs) and [`check.mjs`](../../skills/livediagrams/scripts/lib/check.mjs): local reads, validation and export; no remote dependency installation.
- [`share.ts`](../../src/interop/share.ts), [`useInterop.tsx`](../../src/interop/useInterop.tsx), [`App.tsx`](../../src/App.tsx) and [`diagramIO.ts`](../../src/lib/diagramIO.ts): browser decoding, fragment removal and browser storage.
- [`skill.test.ts`](../../src/ai/skill/skill.test.ts): link round trips, private-diagram refusal, offline CSP and absence of network APIs in export helpers.

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
Validate the merged `master` commit in the portal; revalidate if it changes before submitting.

Expect possible manual review of the existing generated bundles: `scripts/lib/icons.json` and
`scripts/lib/viewer-template.html` exceed 256 KiB, and the viewer/validator contain bundled app code.
They are below the 5 MiB hard file limit. Their readable sources and generators are in this repository
(`scripts/skill-viewer.ts`, `scripts/skill-gen.ts`, `scripts/interactive-viewer.ts`, `src/viewer/`,
`src/export/` and `src/ai/skill/`). Do not remove working assets or hide code to avoid review.
The portal also checks repository archive size/file count; local CLI success is not a promise of approval.

Before submission, use the README's three example requests, inspect the resulting files, and verify
loading on each intended surface (chat, Cowork and Claude Code). Those owner portal/surface checks
remain separate from the repository's automated script and packaging tests.

Recommend **GitHub push webhook** on **master**, with scheduled checks as the directory's fallback.
After submission, use **Set up push updates** (repository admin access required). Keep the webhook
secret in the portal/GitHub configuration, never in the repo. New commits are scanned and reviewed
before going live; a webhook is update detection, not automatic approval or publication.
