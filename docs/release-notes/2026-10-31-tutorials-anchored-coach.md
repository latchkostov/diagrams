## Tutorials: an anchored coach for every lesson

Lesson instructions now sit beside the control being taught, with a quiet target ring and a notch
or short dashed leader. The canvas stays at full strength. Targetless steps stay near the visible
diagram; unavailable targets say so. Tablets keep the card; phones move a full-width sheet away
from the target and shorten its words when necessary. The coach never moves the camera.

Pointer and Keyboard routes point at the exact grow chip, connection dot, reconnect end or search
field as the learner progresses. Routes are display-only: completion checks, demonstrations and
both real-UI solutions retain their contracts. Existing shortcut prose becomes key chips; arrows
are drawn, and product Meta shortcuts show Command on macOS.

Hint, Show me and Do it for me sit with the instruction. Do it for me uses the existing Skip and
demo path to complete the step. After forty seconds without progress, a quiet reminder points out
these exits. Typing and progress reset that wait; nothing acts without the learner asking.
The finished coach joins the completion handoff, leaving its actions clear.

The progress bar contains the lesson title, progress, Restart and Exit. Existing Edit/Live and
history controls occupy their own compact workbench row, so full-height phone docks cannot hide
them. Download and Save a copy targets stay ringed within the coach without making it chase itself.

Grow drops that would touch or overlap their source now leave the normal 160 px connection gap.
Clear manual drops retain their requested position, while new cards avoid
other diagram content. The fix uses the editor's existing placement machinery; simulation behavior
and bundle budgets are unchanged.

## Output parity

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: 35 new English coach messages raise
catalog message counts from 4,542 to 4,577, add 35 English fallbacks per translated language, and
change the tutorials-area fingerprints (including the pseudo-locale). Other area fingerprints
are unchanged. The initial full parity run matched all 3,177 other goldens; no diagram, simulation,
planning, layout, import or export golden was re-recorded.
