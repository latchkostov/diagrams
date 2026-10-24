## Review loop UX review

This changes the engineering CLI and reports, with no editor chrome or interaction changes. The
default command selects the next scoped round and retains intent automatically. The report leads
with the precise file list, counts distinct issues and names contributing lenses. Missing reviewer
output fails visibly rather than presenting a partial review as success. The round-three ending
offers concrete backlog suggestions without silently quarantining tests or merging code. Advanced
scope, lens and round overrides remain explicit command-line options.
