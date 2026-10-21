# Live Diagram: security and privacy submission draft

## Scope and evidence

Reviewed 20 October 2026 against the files below. Recheck the final production commit after the
companion pilot-feedback fixes land. This draft distinguishes technical answers from organisation
and legal attestations that source code cannot establish. No certification is claimed.

| Evidence                                                                                                                                                                             | What it establishes                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../manifest.yml`](../manifest.yml)                                                                                                                                                 | Two Confluence scopes; Forge static resources; no functions, remotes, web triggers, external fetch permissions or app storage modules. Inline styles are allowed, not inline scripts.                                                           |
| [`../src/attachments.ts`](../src/attachments.ts)                                                                                                                                     | Lists page attachment IDs/titles to populate configuration; reads selected attachment metadata and JSON; checks page ownership, IDs, size and version. Uploads/replaces only on explicit editor action. Requests use the supplied Forge bridge. |
| [`../src/config.ts`](../src/config.ts)                                                                                                                                               | Allowlisted macro config: `attachmentId`, `simulation`, `height`, `theme`. No diagram JSON or bridge identity context is saved.                                                                                                                 |
| [`../src/configure.ts`](../src/configure.ts)                                                                                                                                         | Uses `view.getContext`, `requestConfluence`, `view.submit`; submits only the allowlisted config. Uploads immediately, including if config is later cancelled.                                                                                   |
| [`../src/view.ts`](../src/view.ts)                                                                                                                                                   | Uses the reader's bridge context; downloads the configured attachment; loads the viewer in memory; requires a click to play. No server resolver or app identity.                                                                                |
| [`../build.ts`](../build.ts), [`../check.mjs`](../check.mjs)                                                                                                                         | Bundles viewer/config as Forge resources; enforces manifest, bundle and no-egress constraints. Public-site functionality is not loaded at runtime.                                                                                              |
| [`../../../src/lib/confluenceForge.test.ts`](../../../src/lib/confluenceForge.test.ts), [`../../../tests/e2e/confluence-forge.spec.ts`](../../../tests/e2e/confluence-forge.spec.ts) | Offline contracts and fake/real-SDK bridge tests, including permissions/error handling, config allowlist and network/CSP restrictions; these do not certify real-site permissions.                                                              |

## Data flow and retention

The app reads the selected page attachment's JSON and metadata, using the signed-in reader's
Confluence permissions through `requestConfluence`. Configuration also lists the current page's
attachment metadata and reads the selected file to offer its saved simulations. A file chosen on
the device is read and validated locally before an editor explicitly uploads or replaces it.

Diagram content is held in browser memory while rendering or playing. It is stored as a Confluence
page attachment, never copied into macro config or an app database. Config stores only attachment
ID, simulation ID (or Free play), height and theme on the page. There is no Forge Storage API,
independent backend, app-level storage, persistent browser cache, analytics or tracking.

All runtime assets are hosted by Atlassian Forge. The macro has no outbound links or external
requests, and sends no data to Live Diagrams or additional third parties. “Zero egress” means
no transfer outside Atlassian services and the user's browser; normal Confluence attachment and
Forge resource requests still happen. The public documentation site and GitHub support are separate
destinations users may choose to visit; they are not loaded by the macro.

The app requests no profile or email APIs and builds no user profile. It processes no personal
data beyond what Confluence supplies to render the page and the attachment chosen by the user.
An attachment's text or metadata can itself contain personal data; do not claim that all input is
necessarily non-personal. The publisher receives no copy. Forge/Confluence platform operations
remain subject to Atlassian's policies and shared responsibility model.

Data residency follows Confluence for attachments and page macro settings, including Confluence's
supported migration controls. There is no separate app region, external data store or migration
service. Uninstalling the app does not delete customer-owned attachments, their versions or page
content. Delete them with Confluence's controls and retention policies. No independent app copy
remains; do not promise that uninstall erases Confluence content or Atlassian operational logs.

## Scopes and security boundaries

| Scope                        | Why it is needed                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read:attachment:confluence` | List attachment metadata on the page and download the selected diagram and its metadata for configuration, rendering and playback.                                           |
| `write:confluence-file`      | Let a page editor explicitly upload a new diagram attachment or replace the selected file, preserving its ID, name and version history. Not used during reading or playback. |

These scopes permit API operations; they are not a grant to bypass the user's permissions.
The app uses Custom UI `requestConfluence` as the current user, never `asApp`. It checks that the
selected attachment belongs to the current page. Confluence enforces access and upload rights.
No page-body edit, attachment delete, user-profile or external-service scope is requested.

Input controls include numeric content references, same-page metadata checks, an 8,000,000-byte
limit, pinned download version, bounded height/theme/simulation config, native-diagram validation
and restricted pagination paths. Error messages do not include diagram content. Scripts and fonts
are bundled; React Flow requires inline styles, which the manifest expressly permits.

## Privacy & Security tab: answers to paste

Use the current [Marketplace form guide](https://developer.atlassian.com/platform/marketplace/security-privacy-tab/).
The first two “No” answers may hide later data questions. The additional answers here explain this
app if a reviewer requests them; answer only the fields that the form exposes.

| Topic                                            | Draft answer                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External data storage                            | No. Customer-owned attachments and macro settings remain in Confluence.                                                                                                                                                                                                                       |
| Processing beyond Atlassian/the user's browser   | No. Rendering and simulation run in the browser; assets are Forge-hosted.                                                                                                                                                                                                                     |
| Logging content; external logs; sharing logs     | No app logging of diagram content, identity, credentials or tokens. No external log service. Atlassian platform logging is separate.                                                                                                                                                          |
| Remote APIs; runtime customer egress             | No remote API, Forge remote, web trigger or customer-managed external destination.                                                                                                                                                                                                            |
| Additional third parties/sub-processors          | None introduced by the app; no analytics or external hosting for the macro. Atlassian operates Forge and Confluence.                                                                                                                                                                          |
| Residency                                        | Select storage exclusively in Atlassian services with residency support; attachments and macro settings follow Confluence. No independent app store.                                                                                                                                          |
| Migration                                        | Confluence handles page and attachment migration. No separate app migration to run or certify.                                                                                                                                                                                                |
| Post-uninstall app retention                     | No separate retained app copy. Customer-owned Confluence attachments/settings can remain until deleted there.                                                                                                                                                                                 |
| Custom app retention; PETs                       | No custom retention service; no pseudonymisation or anonymisation feature claimed.                                                                                                                                                                                                            |
| Secrets/passwords/PAT access                     | No. The app neither collects nor stores credentials. Forge authenticates bridge requests.                                                                                                                                                                                                     |
| External disk encryption                         | Not applicable: there is no external data store. Do not attest to an independently operated encrypted disk.                                                                                                                                                                                   |
| Certifications; CAIQ Lite                        | None claimed; no completed CAIQ Lite questionnaire supplied in this package.                                                                                                                                                                                                                  |
| Privacy policy                                   | https://www.livediagrams.dev/privacy.html#confluence                                                                                                                                                                                                                                          |
| Scope justification                              | Use the two scope explanations above.                                                                                                                                                                                                                                                         |
| GDPR/CCPA roles, DPA and international transfers | Owner confirmation required. The technical boundary above is evidence, not a legal determination. No separate DPA is supplied here. Do not infer legal status from zero egress.                                                                                                               |
| Security contact                                 | Public support: https://github.com/latchkostov/diagrams/issues/new?template=confluence-app.yml. If the form requires an email address, the owner must supply an organisation-managed security contact directly to Atlassian; no personal address or invented mailbox belongs in this package. |
| Security policy / bounty participation           | No independent security policy or bounty participation attested here. Confirm any programme status in Marketplace; do not substitute public bug reports for private vulnerability disclosure.                                                                                                 |

## Forge app security questionnaire

Numbering follows Atlassian's [Forge questionnaire](https://developer.atlassian.com/platform/marketplace/app-security-questionnaires/)
as checked on 20 October 2026. Conditional remote questions are inapplicable.

| Number / topic                         | Draft answer and evidence                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / User interaction and user identity | Yes. Yes, current-user operations use Custom UI `requestConfluence`, the bridge equivalent of user-context requests; no backend `asUser()` call is needed. See `configure.ts`, `view.ts`.                              |
| 2 / Remote                             | No; no remote host or FIT validation path.                                                                                                                                                                             |
| 3 / App-identity authorization         | Not applicable; no `asApp()` operations.                                                                                                                                                                               |
| 4 / Web triggers                       | No.                                                                                                                                                                                                                    |
| 5 / Display conditions                 | No. Access relies on Confluence authorization, not visibility conditions.                                                                                                                                              |
| 6 / Egress and remote-data protection  | No external hosts. Wildcards, remote TLS/certificate renewal and remote-at-rest controls are not applicable.                                                                                                           |
| 7 / Least privilege                    | Yes. Only attachment read and explicit file upload/replacement; scope rationale above.                                                                                                                                 |
| 8 / Sensitive logs                     | No app content/credential logging or Forge function logs.                                                                                                                                                              |
| 9 / Input validation                   | Yes. Same-page attachment checks, safe IDs, bounded file/config values and native-diagram parsing; see controls above.                                                                                                 |
| 10 / Dependency audit and maintenance  | Owner must confirm a current automated audit and maintenance commitment before answering Yes. Run `pnpm audit --prod` and review results; a lockfile or green unit test is not evidence of a clean vulnerability scan. |
| 11 / Atlassian credentials             | No.                                                                                                                                                                                                                    |
| 12 / Other service credentials         | No; storage follow-ups are not applicable.                                                                                                                                                                             |
| 13 / Plaintext secrets                 | No application secrets required or intentionally embedded. Confirm deployment credentials are kept outside source.                                                                                                     |
| 14 / Vulnerability scanning            | Owner must confirm actual SCA/SAST/DAST runs and reviewed findings; no audit or penetration-test completion is claimed by this document.                                                                               |
| 15 / Bug-fix policy                    | Owner must read and acknowledge the current Atlassian policy; source code cannot attest to this.                                                                                                                       |
| 16 / Incident notifications            | Owner must confirm the notification process and commitment to customers and Atlassian.                                                                                                                                 |
| 17 / Security contact/account          | Owner must confirm an organisation security contact and the required ecosystem support account before submission.                                                                                                      |

## Production verification

Before copying these answers into a submission, deploy the companion fixes, run `forge lint` and
check the real-site checklist in the README with generic data. Verify denied access, reader versus
editor uploads, attachment versioning, click-to-play, Maximise and the Network panel. Confirm
production Runs on Atlassian eligibility with Atlassian's tooling. Never state that offline tests
establish a badge, real-site permission behavior or an organisation's legal/compliance status.
