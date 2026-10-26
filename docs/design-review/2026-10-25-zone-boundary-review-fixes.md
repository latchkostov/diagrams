## Zone and boundary review fixes

Designer-agent code review accepted the changes without blocking issues. Kept the contributor's design: radius customization remains contextual in the inspector, within the existing chrome budget. The range and direct input share 0–40 bounds; native keyboard and pointer editing retain visible focus and Undo. Empty zones keep a usable top-strip hit target through the existing inline-editor/controller path.

Align and Distribute preserve nested boundary subtrees as units and keep one-step Undo. Dashed zones and solid boundaries retain distinct labels and meaning. The public rate-limit showcase demonstrates rounded, aligned regions with existing traffic. Production browser tests verify keyboard focus, numeric and pointer edits, persistence, top-strip editing, subtree movement and backdrop guides; this review adds no new global chrome.
