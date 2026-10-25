## Fan-out and RAG studies await the runner repair API pass

Fan-out and RAG are quarantined again because Skip can leave a study stuck after edits to saved-run,
draft or session state. They are hidden from cards, search, suggestions and deep links; saved progress
stays on this device. Cells remains available with its negative coverage, and the PR's other tests
and infrastructure improvements remain intact. The findings are tracked in
`docs/backlog/2026-10-24-tutorials-quarantine.md` for a runner repair API design pass across all five
quarantined studies. No parity goldens changed.
