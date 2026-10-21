## Confluence Marketplace documentation UX review

The documentation uses the same system font, column width, light/dark palette and script-free
structure as Privacy and Terms. It adds no editor controls or runtime requests. The installation
status says “coming soon” as plain text, so there is no dead install button before approval.

The steps use existing labels: Diagram file, Free play, Play diagram, Automatic, Follow Confluence
and Replace selected attachment. Upload timing, version history, permissions, the still starting
state and the external editing workflow are explicit. Troubleshooting offers concrete next actions.
New links have data-testid attributes. Support warns against sharing private or work diagrams.
Production Chromium checks pass for the documentation/privacy links and existing static pages.
Visual inspection at desktop/light and mobile/dark widths confirms readable text and no horizontal overflow.

Rejected autoplay, an editor inside the macro, an outbound macro attribution link and external asset
services because the approved defaults are view/play, click-to-play and zero egress. Reused the
connected-node brand as vector artwork with existing Playwright exports; no image-generation or
heavy graphics dependency is needed. Real product screenshots remain an orchestrator capture task.
Organisational attestations are marked for owner confirmation rather than inferred from code.
