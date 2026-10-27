## Workbench review round two

- Inspecting a node and clearing selection restores an open AI tab with its unfinished request,
  reply and validation feedback intact.
- Add and Annotate yield Escape to dialogs; closing the command palette returns focus to its
  still-mounted search field before a second Escape closes the flyout.
- Phone framing accounts for the bottom dock at every snap height, and reframes when that height
  changes. A full-height sheet no longer collapses the frame's width.
- Changing edge style refreshes settled frame detail.
- Docked Checks retains keyboard focus when its last finding disappears.
- RTL playback keeps the timeline's coordinates left to right, with RTL transport chrome.
- Pin open overlays the phone canvas in Edit and Live instead of narrowing it.
- Phone AI footer tests explicitly cover browsers with and without the optional Prompt API.

## Output parity

The final fixes leave every output golden unchanged. The optional ordinary flow-label text-floor
attempt and its font-style goldens were withdrawn after the full Linux sweep exposed caption
overlaps. That P2 needs collision-aware placement and is tracked separately in the backlog.
