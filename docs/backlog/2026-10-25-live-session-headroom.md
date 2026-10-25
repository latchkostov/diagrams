## Live session bundle headroom follow-up

Owner: Live bundle maintenance lane, in a dedicated trim PR.

The owner-decisions branch measures Live-session gzip at 130,916 B against the unchanged 135,000 B
budget: 4,084 B headroom, below the 8,192 B warning floor. Its same-run merge-base is 130,922 B,
so this batch reduces it by 6 B. Keep the fixed budget and schedule a separate trim; the Inspector
control stays lazy. Canvas first-view headroom remains 18,578 B (364,422 / 383,000 B).
