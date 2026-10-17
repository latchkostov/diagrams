## Collaboration C1b prerequisite: device wipe (C1a review, 2026-10-16)

- **P2: include room recovery in Clear everything on this device.** The Lab-only IndexedDB checkpoint
  store is not yet part of the synchronous localStorage/sessionStorage wipe. Before production rooms
  are enabled, extend the shared storage lifecycle to register asynchronous stores, stop old-generation
  writers before deleting their records, and wait for deletion before acknowledging the wipe. Cover
  concurrent tabs, pending encryption/IDB writes, blocked deletion and a room reopened with its old link.
  This needs a coordinated lifecycle change rather than a fire-and-forget database delete. Until then,
  clearing the browser's site data removes Lab checkpoints; the Lab explains its normal bounded retention.
