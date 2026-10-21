## Confluence Cloud Forge groundwork

Added a separate private-install Forge app in `integrations/confluence-forge`, ready for the owner to
register. Its Custom UI loads a page attachment as the reader, keeps diagram content in memory, and
opens still until **Play diagram**. Configuration chooses an attachment, uploads/replaces a file with
Confluence version history, and selects a simulation, height and theme. Only those four settings are
stored in macro config. No external permission, link, backend or main-app behavior change is added.

The README leads through dev-site creation, API token, CLI login/register/deploy/install, macro insertion
and the manual checks still needed. Offline CI checks configuration privacy, attachment transport,
manifest fields, resource size and the built UI under Forge-like CSP. Real Confluence download redirects,
multipart upload, permissions and auto-height remain owner verification items; Runs on Atlassian
eligibility has not been certified. Export/editor/Jira/Marketplace work remains outside this pilot.

Output parity: only `node/i18n/catalogs.json` changes, recording 30 new Forge English messages,
fallback counts and the `viewerForge` namespace digest in each locale (plus pseudo-localization).
Existing namespace digests are unchanged. Existing diagram render, simulation, export and layout goldens
must remain unchanged; no diagrams or output baselines are re-recorded to hide failures.
