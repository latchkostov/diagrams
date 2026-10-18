## Live session interfaces

Move the live controller, simulations, draft, panels and session lifecycle into
`src/live/session/useLiveSessionState.ts`. Command and recording hooks stay in
`useLiveCommands.ts`. Pass named session, commands, spotlight, tracing, motion,
recording and capacity APIs between hooks instead of spreading their fields.

This is a pure refactor: behavior, timing, DOM, test ids, ARIA and UI text stay
unchanged. No parity golden is updated. Production code across `LiveSession.tsx`
and `session/` falls from 1,940 to 1,876 lines; the largest hook interface has ten
top-level inputs. Tests are unchanged.

Regenerated the skill's bundled viewer so it includes the refactored session.
