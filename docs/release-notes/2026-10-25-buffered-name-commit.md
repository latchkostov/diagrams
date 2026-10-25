## Buffered names survive the next shortcut

Enter now writes a new node's complete buffered name and closes its creation transaction before
releasing the keyboard, even while measurement or the reveal frame is held. Alt+Right can immediately
add the next node. Undo followed by a late reveal and Redo restores the accepted name, rather than
the stencil's default name. The interaction controller publishes naming completion in the same task.
The full name also survives a handoff from measurement to an inspector whose code is still loading.

This fix changes no parity goldens. The PR's existing `node/i18n/catalogs.json` diff still describes
the earlier `admission.quotaLimit` message, its fallback in untranslated locales and admission-area
hashes; this naming correction adds no messages or simulation output changes.
