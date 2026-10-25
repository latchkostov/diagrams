## Final Live trim keyboard and loading review

No controls or chrome were added. The existing Loading notice represents an unfinished
journey; an unrelated highlighted path cannot take its place. The ready journey takes
precedence after download, retaining the requested message.

One eager keyboard policy now governs both pending reservation and downloaded playback.
Native summary, button, link, select and input activation keeps its browser behavior;
range inputs retain Escape, and button arrows retain replay stepping. Capturing replay
work reserves replay keys, active playback executes them, and an armed replay owns only
Escape. The shell fallback acts only while its facade request is pending.

Held-download browser tests cover existing edge highlighting, Enter on the AI disclosure
before and after handoff, armed Space/Enter and Escape, and ordinary timeline seeking
during trace download. All four regressions fail with their corresponding behavior
removed (timeline coverage uses a disabled-seek mutant). The spotlight test observes a
fresh decorator publication so the preceding waiting-at-node paint cannot mask the bug.
The loading boundary and budgets remain intact; no golden updates or broader feature work
are included in this final fix round.
