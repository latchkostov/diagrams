## Retired-example edits: recovery follow-ups

From the #172 review of the retired-edits adoption (`adoptRetiredExampleEdits` in `src/lib/diagramIO.ts`):

- **Recovery without automatic downloads.** When storage is full, the only recovery is the notice's "Download edits",
  which saves one file per failed migration. A browser that blocks multiple automatic downloads, or a person who
  dismisses the notice, leaves the edits reachable only after freeing space and reloading. Offer them through a
  persistent place (for example a recovery row in Your diagrams) that opens or exports each one on demand.
- **A lock-contending concurrency test.** "failed concurrent adoption preserves the peer's committed copy" uses a fake
  Web Lock that queues callers. Add a test where two module instances genuinely contend (the second request starts
  while the first holds the lock and is mid-write) and a browser-level check with two pages.
- **Other startup notices.** The recovery notice is a toast; another startup notice can replace it before the person
  sees it.
