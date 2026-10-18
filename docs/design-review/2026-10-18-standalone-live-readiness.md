## Standalone Live readiness

The existing Live toggle now reports its mounted session accurately to assistive technology for
standalone hosts as well as the editor. No controls, copy, layout or keyboard behavior are added.
Readiness is local lifecycle state; an optional external observer must not control whether it resolves.
The regression exercises the existing keyboard Lab preset through mounting, exit and re-entry.
