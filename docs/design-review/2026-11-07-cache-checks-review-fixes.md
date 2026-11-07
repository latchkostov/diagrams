## Cache Checks fix-round UX review (#444)

No controls or chrome added. A finding names the origin its rule actually reaches, and its replica action edits that origin. Separate overloads retain their capacity warning. Rule order and a stampede-only request no longer hide another rule's warning.

The destructive method action explicitly says “Delete this cache rule” in English and Arabic. Browser coverage checks the exact action text, whole-rule deletion and one-step Undo in both languages. TTL suggestions remain informative when their replay cannot prove an edit. Existing cold-probe explanation and localized Checks presentation stay in place.

Rejected raising replay budgets, relaxing assertions and replaying analytically healthy caches: none improves correctness, and the last repeats expensive simulation setup without any possible warning. The existing public example demonstrates the corrected stampede behavior; no new feature or example is introduced.
