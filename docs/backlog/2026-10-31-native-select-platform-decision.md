## Orchestrator decision: native macOS select input

Four native-select cases persist in both baseline Nightlies. Explicit Space/Enter did not repair the macOS metric-picker cases in branch Nightly 41183332686. Both select experiments are removed; the original Speed and three translated metric tests remain enabled with their original navigation and exact values.

[Chromium's confirmed input issue](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/3033) explains that macOS opens a Cocoa menu in the browser process, which renderer-directed CDP keys cannot operate. Character typeahead remains in Blink. This makes popup automation a different boundary from application keyboard handling; more waiting or renderer key codes cannot fix it.

Required synchronization brought in master #402's new keyboard tutorial suite. In 41183332686, **34 of its 39 macOS failures** stop at line 259 waiting for the native popup to close after Enter. This is the same boundary, not 34 independently demonstrated application failures. The other five keyboard failures require separate investigation. Windows has five keyboard failures at different boundaries; the clean-master two-repeat comparison returned busy (75), so they are not labelled proven pre-existing.

`scripts/ci/native-select.mjs` isolates arrow/Enter, Space/End/Enter, Alt+ArrowDown/Home/ArrowDown/Enter and printable typeahead on an otherwise empty document using the pinned browser and shared launch flags. It records trusted/default-prevented events, selected indices and popup state after actual animation frames. Every mode closes its browser. Native shard 1 uploads the same-run evidence as `native-select.json`; no test result is replaced or reclassified by the diagnostic, and no deadline is increased.

Proposed decision: provide a native macOS input driver for OS-menu keyboard coverage, or explicitly adopt renderer typeahead coverage for the existing native controls. Replacing product selects with custom controls would require an accessibility and UX decision. Programmatic selection is rejected as evidence for the existing arrow-key oracle. No skip or quarantine is introduced.
