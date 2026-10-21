## Follow-ups 15 UX review

The required designer-agent source review found no blocking UX issues. If the reader moves to an
option during validation, Forge restores that equivalent in-panel control while the frame owns
focus. An ordinary file choice still moves focus to the new attachment card. The existing async
focus guard prevents a later card fallback from overriding an intervening interaction. Size and
theme remain behind Options; no control, label, layout or chrome is added.

Classic Mermaid text keeps its established meaning, while extended shape attributes retain YAML
escaping. Export uses the existing Cancel and retry paths; the regression exercises editing before
the stalled geometry download finishes. Relay progress changes no surface.

Scope: source review of the diff and surrounding focus, parser and export behavior. The designer
agent did not perform a browser walkthrough. Browser regressions separately exercise focus,
captured endpoints, cancellation and preview limits on the production build.
