## Follow-ups seven UX review

The changes preserve the existing chrome budget: no new controls, menus or shortcuts. Keyboard
navigation keeps selection and focus together across peer updates. Undo of a hidden dependency
returns focus to the canvas and completes readiness; dependencies still waiting to render retain
their existing recovery behavior. A newer navigation request wins over pending Escape restoration. Conditional peer recovery follows
the most recent focused element while preserving pending user requests.

Live session wording stays identical in English and uses whole translated sentences with placeholders.
Undo and Live reuse existing vocabulary. Slow-motion notes update when the language changes, and the
dead-letter waiting notice keeps its identity independently of the displayed language.

Rejected: routing Live keyboard/menu ownership through the controller in this batch (coordinated
separately), enlarging slow-motion test deadlines, weakening assertions or growth limits, retrying
failed browser navigation, and re-recording diagram goldens. Each would either exceed scope or hide
the behavior under test.

Conditional recovery also handles a removed Inspector control while its retry is pending. It runs
beside the pending request, so a surviving field still receives focus when mounted, while the
canvas provides a keyboard destination if the old owner disappears. Newer navigation takes
precedence. The existing collaboration assertions stay intact; no focus or camera assertion is
weakened.
