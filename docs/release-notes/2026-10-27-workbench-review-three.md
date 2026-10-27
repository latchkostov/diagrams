## Workbench framing fixes (PR #359, review round three)

Follow frames the whole narration only while it stays at or above the readable zoom floor (90%, 92% on a phone). The earlier rule zoomed out as far as needed, down to 15%; on phones and in the large showcases that left titles near 6 px. Narration that needs a smaller zoom keeps its subject at the floor, and its distant narrated cards become pins, as before this PR. Vertically spread narration still fits inside the actual visibility margins when the floor allows it.

An expanded phone note now counts as part of the canvas it covers. Cards and badges under the sheet become pins, rather than showing a half-covered card. A connection label that has to slide prefers spots clear of other labels' own places. It takes one only when nothing else is clear, so no label becomes hidden. No parity goldens change.
