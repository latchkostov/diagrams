## Follow-ups 14: current connection handles

Inspector width and height edits now refresh shape handle measurements after the handles render at
their new positions, using the shared canvas measurement queue. Outline changes use the same queue;
mounting and pasting retain batched observer measurement. Handle geometry is reused across position
and selection changes, with opposite attachments computed together.

Mermaid shape labels preserve single-quoted braces, semicolons, doubled apostrophes and literal double
quotes through both statement splitting and attribute scanning. Following statements and connections
remain intact. Double-quoted escapes use the shared quote handling too.

Browser regressions compare preview origins and completed connection endpoints with visible handles
after paste, width/height edits and a same-size outline change. New connections retain automatic side
selection, which the tests verify against the saved endpoints. No controls or wording change.

No parity goldens are intentionally changed by this round; the frozen outputs should remain identical.
