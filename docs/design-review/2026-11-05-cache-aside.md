## Cache-aside UX review

The existing connection disclosure gains **When**, with **Every request** and
**Only when Product cache misses**. The active condition appears in its collapsed
summary. The disclosure uses **Request details** when a cache lookup is available;
the secondary hint names the technical pattern and explains implicit write-back.
There are no new menu items or always-visible controls.

The designer's code review requested an explicit cleared saved override, the active
condition in the collapsed summary, a readable override note, and a concise accessible
name. All four changes are implemented, with a regression for clearing an inherited
condition in a saved simulation. Arabic translates the new controls and isolates
the authored cache name.

The first screenshots exposed a clipped selected condition in both languages. The
select and its hint now span the existing disclosure row. A browser regression
requires the control to occupy that row rather than the narrow value column.
The designer approved the updated English and Arabic screenshots: the complete
condition and isolated authored name are readable, and the hint stays secondary.
Production browser tests pass in both languages, including Undo.

Public fixture screenshots: `C:\Users\latch\bin\codex-tasks\cdn-5-shots\cache-aside-en.png`
and `cache-aside-ar.png`. No new menu items or toolbar controls were introduced.

## Final selector review

The selector now indexes node identities once per lookup rather than scanning the
node list for every connection. Regression tests preserve connection order,
current labels and fallback text. The designer approved the read-only follow-up:
there are no visible UI changes or concrete issues, and both approved public
screenshots remain representative.
