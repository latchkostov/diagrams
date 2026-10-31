## Tutorials: the Syllabus hub

Tutorials now reads as a six-chapter syllabus: a suggested next lesson, numbered lesson rows,
shape-and-word progress, a segmented overall bar and seven quiet monochrome seals. Any lesson can
be opened at any time. A completed lesson records its first finish date; older completions without
a known date simply say Done. Earned seals retain their first recorded dates across lesson versions.

The Seals page explains each criterion and its progress. Reset progress lives in the header menu
and beneath each open chapter. One confirmation offers everything, a chapter or the current lesson,
names the finished/in-progress/seal counts, and leaves diagrams and settings alone. Its toast offers
Undo from an in-memory snapshot, including after navigating away from the hub and back.

Lesson content, checks, the runner and the in-lesson finish handoff are unchanged. The first-lesson
seal, locks and celebrations are deliberately omitted. The hub remains lazy and outside the skill
viewer; bundle budgets and reserves are unchanged.

## Output parity

Only `node/i18n/catalogs.json` intentionally changes: the new English Syllabus messages increase
catalog counts and untranslated fallbacks and change the tutorials-area fingerprint. Other locales
may fall back to English. Existing diagram, simulation, planning, export and browser goldens remain
unchanged. No diagram-output golden is re-recorded.
