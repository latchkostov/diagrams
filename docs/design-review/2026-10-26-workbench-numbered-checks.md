## Checks review

One disclosure reduces the number of competing controls without hiding a finding's reason. Titles hang beside a 20px number and wrap under themselves. The complete list owns numbering; selecting a row makes the canvas and dock point at the same finding. Unrelated findings remain visible as one readable count per element. Warning and suggestion semantics are unchanged.

The 24px targets counter-scale with the canvas, while their ink stays 20px. Count digits use full text ink on the panel ground; selected tags use dark ink on amber, with separate board and amber rings. The browser tests check both themes at 4.5:1 and opacity 1.

## Interaction and regression checks

Tests cover one expanded row, sentence truncation including CJK and Hindi punctuation, stable numbering under filtering, selected tags versus aggregate counts, filter cleanup after a fix, and shared selection notifications. Forcing every row open makes the disclosure regression fail; restoring the implementation passes it.

Tests that use a non-first fix now open that finding and wait for selection/check readiness before keyboard activation. The privacy Undo flow reopens the moved AI tab before reading its restored conversation. Tutorial regression coverage also found the editing disclosure needed an end snap target after a tall run chart; local playback now reserves its measured height, keeping that control above the footer.
