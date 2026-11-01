## Keyboard ownership in the command palette

Background context updates must not replace the person's highlighted command. The palette retains
the command's stable identity and resolves its new index in the current results, so Enter runs
the current action. A changed query or submenu still starts with its best match. Missing commands
fall back to the first result. No controls, wording or visual treatment are added.

Waiting for every live/context publication to stop in a test was rejected: those publications can
continue while a person uses the palette, and their arrow-key choice must survive them.
