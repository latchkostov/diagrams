## Toast focus and actions after Workbench

Dialogs and the shortcuts sheet claim their toast opener before moving focus. A waiting
notification can no longer remove the opener during that handoff. Dialog replacement keeps
the original opener, including through StrictMode effect replay.

An action that has completed becomes unavailable while its button remains mounted for modal
focus return. Repeated recording Discard/Undo cycles therefore retain the correct clip and
cannot restore a clip through an already consumed Undo.

Page notifications share Workbench's stacking context, below flyouts, transport menus and
phone sheets. Registered modals still hide and pause earlier notifications. The nonmodal
phone note sheet yields Escape to an open modal instead of closing ahead of it.

The only intended golden change is `node/i18n/catalogs.json`: the existing toast work adds
`toast.undoUnavailable`: 38 message counts, 37 English-fallback counts and 38 toast-area hashes
change. The en-XA catalog supplies its pseudo-translation. Diagram, simulation and export
outputs are unchanged.
