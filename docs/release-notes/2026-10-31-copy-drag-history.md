## One Undo for a copy drag

An Alt-drag stays one undo step even when its initial copy is recorded before the
drag's next position arrives, or the pointer is held beyond the normal merge
window. Undo removes the whole copy, including its shaped line. The next edit
remains a separate step.

Local gestures now use the same explicit transaction lifetime as collaboration
gestures. The fake-clock regression fails without the fix because Undo leaves the
copy behind. No drawing, simulation or export output is intentionally changed.
