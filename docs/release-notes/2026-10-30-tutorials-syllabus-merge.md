## Tutorial syllabus merge

Merged master into the lesson handoff branch while preserving both tutorial fix rounds. Reset Undo still refuses to overwrite newer progress, reset restores focus to its opener, lesson action names include Start/Continue/Review, and scoped resets preserve other lessons. The finish handoff retains its Escape handling, scoped auto-start, route cleanup and keyboard navigation. Stored step validation lives in one shared progress reader; the resume display also clamps oversized indices.

Both sets of unit and browser assertions are retained, including the stronger accessible names and reset focus checks alongside the handoff and radio navigation checks.

Only `tests/parity/goldens/node/i18n/catalogs.json` differs from master. It was regenerated for the twelve `tutorials.handoff.*` messages: catalog message counts increase by twelve, untranslated locale fallback counts increase by twelve, and tutorial namespace fingerprints change (including the pseudo-locale). All other golden outputs are unchanged.
