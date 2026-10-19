## PR #206 second recovery review

Source review against the UX principles: retry backoff and saved outages now follow their existing timing contracts, and recovered continuations drain instead of remaining queued behind their own capacity. No controls, text, layout, focus behavior or chrome were added. This narrow correction needs no new showcase scenario.

Rejected routing recovered work through ordinary admission because it restarts latency and spends quota before the retry deadline. Removed the combined lease result because one weight cannot describe separately retained request and execution occupancy.
