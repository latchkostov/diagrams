## Scope

Narrow second-review follow-up for annotation handle measurements, cached geometry and Mermaid quoting.

## Findings

A read-only designer-agent source and diff review found no blocking UX issues. Width, height and
outline edits keep the connection origin aligned with the rendered handle, restoring consistent
direct manipulation. Existing inspector controls and the canvas measurement queue are sufficient;
no new controls, labels, chrome or interaction steps are added.

## Verification

Four browser cases compare connection previews and completed edge endpoints with rendered handle
centres after paste, inspector width/height changes and a same-size outline change. They also check
saved endpoints and resolved automatic sides. The test clears resize grips and fits both endpoints
before measuring pointer coordinates. Unit tests cover quote boundaries and cached geometry without
elapsed-time thresholds. Execution results are reported separately from the source UX review.
