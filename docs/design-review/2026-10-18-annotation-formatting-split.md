## PR 179: immediate text, deferred formatting

Reviewed the split against the D7 text-editing contract and chrome budget. The plain
textarea owns its value, initial selection, ordinary keys and commit behavior before
formatting downloads. A renderless enhancement attaches only Markdown handling to
that existing element, using its current value and selection on each key event.
Cleanup removes the listener, and the standard lazy loader retains failure/retry
behavior. No control, placeholder, toolbar or new copy is introduced.

The unchanged D7 cases pass. The route-held regression checks exact multiline text,
caret movement, a formatting key before readiness, element identity, focus and selection
after readiness, then bold formatting of the preserved selection. The production
bundle test pins the eager base and deferred formatting in both collaboration builds;
restoring the original eager import makes that test fail. Image-export code is untouched.

Rejected deferring the textarea itself, which recreates the lost-keystroke race, and
raising the budget. The resulting 645-byte headroom is below the 1 KB target; further
unrelated canvas changes would broaden this focused fix.
