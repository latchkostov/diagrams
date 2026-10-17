## draw.io planning preservation (showcase review, 2026-10-15)

- The adapter emits v1 and drops v2 planning revision and shared quota definitions. Node/workload
  fields round-trip, but planning playback does not. Preserve the planning model in draw.io metadata
  and report any losses; add a v2 round-trip regression and deliberately update the existing P3
  parity corpus when implementing it. The showcase batch records this existing limitation explicitly.
