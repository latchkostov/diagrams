## Gate resource integration review

Docker resource caps and admission controls remain independent options with their existing
validation and diagnostics. Automatic worker sizing now respects container caps before the
reservation is made, keeping the reported budget and launched work consistent. Explicit worker
overrides remain available. FIFO, holder metadata and bounded waits are preserved.

This tooling rebase adds no editor controls or changes to canvas interactions. PR CI remains the
full gate with zero retries; targeted local checks remain the default contributor path.
