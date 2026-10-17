## Parallel-work follow-up UX review (2026-10-17)

The changes restore readable plugin discovery text and make schema links work beneath a development
base path. They add no controls, menus, dialogs or canvas behavior, so the chrome budget is unchanged.
Sync preserves both contributors' independent authored changes and stops with the existing actionable
resolution instructions for competing edits. Development schema caching is scoped to each server;
source changes require a restart, documented beside the middleware and in the release note.

Rejected: re-recording parity goldens (no intended output change), a manifest-version rewrite (updates
track commits), and watcher-only cache invalidation (it would reserialize stale static Node imports).
