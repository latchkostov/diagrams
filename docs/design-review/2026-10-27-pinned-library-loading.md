## Pinned library loading shell — PR #368, fix round 1

The eager loading/error shell now uses the existing search/header row, accessible Close library action and Pin open action. The same callback updates the remembered pin setting and closes the surface. The shell carries its mode and accessible name immediately, so the phone positioning rule applies before any stencil contents arrive. No new control, translation or preference is introduced.

Rejected loading the full library eagerly: its stencil contents remain optional, preserving the trim's download savings. Kept the existing Close library wording and close icon for Unpin rather than introducing a competing action.

The targeted two-repeat trim-first-view/palette gate and reserve-heavy gate were refused by shared admission with exit 75 while another live gate occupied all 12 slots. Browser checks, mutation checks and the heavy reserve assertion remain unverified locally; the fix-round busy-gate rule delegates them to PR CI. No lock was bypassed. The production build, size check and i18n validation passed. No parity golden was changed or re-recorded; parity was not rerun in this targeted fix round.

The final production files measure 158856 B startup, 370706 B canvas first view and 128488 B additional Live JavaScript (gzip level 9, recursively following static imports). These retain 3594 B and 3126 B of the original canvas/Live savings. Canvas remains below the unchanged 370712 B tightened ceiling; Live remains below 128856 B. This inspection checks the emitted files but does not substitute for the blocked heavy regression.
