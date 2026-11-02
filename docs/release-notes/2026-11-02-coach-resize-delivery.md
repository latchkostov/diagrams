## Coach measurements across browser deliveries

Tutorial coach placement now ignores resize notifications for rectangles already read by its latest measurement. Browsers deliver mutations before resize observers and drain microtasks between separate resize callbacks; the previous microtask flag alone allowed several full placement scans for the same change. Mutation notifications still invalidate placement even when root sizes stay unchanged, and genuine later resizes still measure before paint with animation frames paused. Initial placement remains synchronous.

The regression now delivers mutations, drains microtasks, then invokes each resize observer separately with another microtask drain between callbacks. It checks measurement counts, later mutations and resizes, and queued/late delivery cleanup. Before the fix it observed four measurements where two were expected (initial placement plus the change).

No output changes or golden updates are intended. This fix round uses the targeted tutorial unit and Linux browser gates; parity remains for CI.
