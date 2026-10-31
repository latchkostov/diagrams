## Tutorial syllabus review follow-ups

- R-235dce8195: replace positional chapter/seal pairing with a shared, exhaustive descriptor lookup.
  Keep this structural cleanup separate from the reset safety and accessibility fix round.
- R-061c6d05da: add browser coverage proving that backfilled legacy chapter-seal dates persist across
  reloads on later dates. Unit coverage already checks seal retention; persistence-effect coverage
  remains useful follow-up work.
