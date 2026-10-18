## Live's "⋯" menu: give focus back on Esc

The Live bar's "⋯" menu (`MoreMenu` in `src/live/ControlBar.tsx`) closes on Esc without giving focus back: tabbed into,
its item goes with the menu and focus falls to the page. The expectations list beside it gives focus back to its
button (focus policy row M5). Kept as it was by the Live interaction refactor (behaviour unchanged), and flagged in
`docs/design-review/2026-10-18-live-interaction.md`.

## Follow-up

If the owner agrees, pass the "⋯" button as the popover's invoker (`useLivePopover(() => button.current)`), so M5
returns focus to it, and add a journal assertion for Esc from inside the menu in `live.spec.ts`.
