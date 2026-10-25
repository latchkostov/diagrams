## Tutorial Skip recovers from canvas edits

Align restores the lesson's selection when fewer than four nodes remain selected, while keeping a valid learner selection. Boundary repair keeps existing members in place and places missing members in free space through the editor's placement and membership rules, in one Undo step. Inserting a gateway reuses one added separately and repairs missing connections.

The completion sweep covers all 42 tutorial steps with 294 contract cases, including 126 selection and extra-node perturbation cases. Browser regressions cover cleared selection, a separately added gateway, and preservation of original diagram edits after leaving Share and present. No parity goldens were edited.
