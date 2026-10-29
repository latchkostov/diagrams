## Stabilization review

This change repairs locale-download interception in browser tests. The editor's controls,
keyboard behaviour, language switching and canvas remain unchanged. Existing pending/failure,
Retry, search, naming and focus assertions remain active. No additional chrome or copy is added.

The unresolved native font, select, admission and timing observations retain their exact
assertions and require controlled evidence before changing product behaviour. No new skip,
quarantine, retry, tolerance or budget is introduced. Output parity must remain unchanged.
