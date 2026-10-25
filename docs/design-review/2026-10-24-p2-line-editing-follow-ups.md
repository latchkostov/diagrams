## UX review: line editing follow-ups

This batch preserves the existing line-editing interaction and route geometry. Automatic overlapping lines must still separate, their ports stay attached, and hand-shaped routes stay fixed. The strengthened regression asserts these visible outcomes together rather than only checking that routing ran.

The interval-index and clustering changes add no chrome, focus changes, menus, settings or text. They support the existing “Nothing overlaps by default” contract during routing. A separate clustering implementation was rejected because it permits the eager and deferred routing paths to drift; both now share the exact rules. Prefix maxima were rejected because an early spanning interval prevents pruning unrelated expired ranges.

Output parity must remain unchanged. No golden re-recording, budget increase or unrelated trim is part of this fix round.
