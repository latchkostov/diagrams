## Phone narration can't zoom past the canvas's 15% minimum

On a 390 px phone, Live fits a large showcase (40–60 cards, about 5,000 px wide) at the canvas's minimum zoom of 15%
(`minZoom` in `src/canvas/CanvasView.tsx`). A narration note's close-up then stays at 15% too: the camera pans the
note's cards into view but doesn't zoom in, so card names render at about 2 px. Measured with the Payments story's
“Adyen starts failing” note: free play and the note both at `scale(0.15)`, only the translation changes.

The #172 review asked for a phone test that the close-up is at least twice the overview's zoom; that holds for the
estimated geometry but not in the browser, so the e2e test asserts only that the note never zooms out and that its
cards are inside the canvas and clear of the note and playback bar. Desktop close-ups are unaffected (60% or more).

Possible fixes: let a narration note's fit zoom in past the overview when the pane is narrow, or fit a
note's focus with phone-sized insets.
