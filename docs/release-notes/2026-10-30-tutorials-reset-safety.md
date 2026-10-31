## Tutorial reset recovery and accessibility

Reset Undo now refuses to replace progress after a subsequent tutorial save, highlights change or
cross-tab storage change, and explains why. Undo remains available across navigation while storage
is unchanged. The reset dialog returns keyboard focus to its opener on Escape, Cancel and confirmation.
Lesson action names now include the translated Start, Continue or Review label before the lesson
number, title and progress. Invalid saved resume steps no longer crash the hub.

The only changed parity golden is `node/i18n/catalogs.json`: each locale gains one message and
the untranslated locales gain one fallback for the unavailable-Undo explanation. Tutorial-area
hashes also change for that message and the action placeholder in lesson names, including the
pseudo-locale. No diagram, simulation or export golden changes.
