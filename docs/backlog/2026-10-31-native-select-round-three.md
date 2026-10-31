## Adopted macOS keyboard path

The orchestrator accepted printable typeahead for native macOS selects. The shared
keyboard driver reads the requested option's displayed label and types it into the
focused, closed select. Tutorial choices and the direct Speed and translated metric
cases use this path on macOS. Windows and Linux retain their navigation and popup
coverage. Exact selected-value assertions remain unchanged.

Baseline Nightly 41220274105 retains the Cocoa-popup failures. Branch Nightly will
measure the adopted path on native macOS; local Windows cannot emulate Cocoa input.
The isolated native-select diagnostic remains unchanged. No programmatic selection,
skip, quarantine, timeout or tolerance change is introduced.
