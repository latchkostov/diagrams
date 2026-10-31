## Syllabus hub UX review

Reviewed the built hub at 1440 px and 390 px in light and dark, plus the Seals page and reset dialog.
The layout follows the Syllabus reference with real app tokens, ink primary actions, the existing
menu, modal interaction and toast systems, and Geist Mono chapter marks and lesson numbers.

The header has only Seals and a More menu. The suggested next lesson is the sole primary action;
chapter disclosures reveal dense rows on demand. At phone width the progress bar and actions wrap,
lesson words keep their space, and lesson actions occupy a full row. Chapter blurbs collapse on
phones. Nothing is locked. The initial suggested chapter is open so its lessons are discoverable.

Every glyph has accompanying status words in the lesson action's accessible name. Disclosures use
aria-expanded and aria-controls; headings structure the page. The shared modal interaction traps
focus, makes the background inert, closes on Escape and restores focus. Reset uses an alertdialog,
native radio group and an explicit count summary; Cancel receives initial focus. Undo restores the
exact browser snapshot without persisting a recovery copy. Local subscriptions refresh a remounted
hub when the retained Undo action runs.

Rejected extra gamification, a first-lesson award and new global controls. The finish handoff stays
for PR 2 as requested. Production accessibility scans cover the hub, Seals and reset dialog. Built
captures are in the owner's `tutorials-hub-2026-10/built-1/` folder.
