## Skill viewer headroom review (PR #286)

No controls, words or layout change. The trim follows the existing read-only viewer boundary:
fix callouts require an editor and cannot appear in either exported viewer. Their authoring code
can therefore be excluded while keeping saved simulations, shedding playback, badges, readouts,
diagram synchronization and saved-route rendering. Tutorial UI and shedding Inspector controls
are explicitly guarded against entering the viewers. The app retains the original editing hook.
