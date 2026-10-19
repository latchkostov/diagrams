## Confluence Data Center macro

The page shows a fitted, still diagram and one optional Play diagram action, enabled only when loaded.
The button uses native keyboard behaviour; load errors appear beside the diagram as an alert.
Height and source stay in macro configuration, with no new editor chrome. Multiple macros work independently.
Click-to-play off hides the extra action and never starts playback; the viewer retains its manual controls.

The administrator fixes the viewer origin once. Attachment URLs stay on the Confluence origin, preserving
the page's session and attachment permissions. Inline JSON is escaped as data and inherits page visibility.
The recipe deliberately avoids a Java plugin and leaves Cloud integration and destination UI for later work.
Real Confluence rendering and Velocity compatibility require an administrator smoke check.
