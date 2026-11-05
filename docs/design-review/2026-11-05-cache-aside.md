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
the authored cache name. English/Arabic browser and screenshot review follows.
