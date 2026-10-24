## Tutorial runtime hardening

The development and E2E tutorial runtime now supports node and connection properties, relationships, boundary
membership, annotations, Live metrics, saved simulations, expectations, Faults, traces, slow motion, narration
notes and editor modes. Skip uses the editor API and the same guarded Fault actions as the command palette.

Lessons can start from a fresh copy of a public example and a seeded saved simulation. Loading waits before
showing Start, with Retry and Exit after a failed download. The app-chrome variant keeps the real File, Share
and Present controls; its picker names the tutorial. Present hides teaching chrome. Save and Save as explicitly
keep a library copy, including their keyboard shortcuts.

The finish card offers the first unfinished lesson in the same track and an optional Save a copy to Your
diagrams, with an Open action in the success toast. Copies are never automatic. Entry points include tutorial
titles in Ctrl+K, the empty-canvas invitation and the shortcuts footer. The existing mobile-api lesson remains
the learner catalog; the runtime integration previews live in the Lab.

The authoring checks now validate the new subjects, public example and simulation references, and naming
completion. Generated browser coverage includes every solution and Skip-all, accessibility, Arabic, Highlights
off, example loading and recovery, app chrome and explicit copies.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: the 15 new tutorial messages increase each locale's
message count by 15, add 13 English fallbacks in untranslated catalogs, and change the tutorial-area fingerprints.
The pseudo-locale covers every new message. Every other area's fingerprint and all other 3,146 goldens stay unchanged.

Production gzip budgets pass after syncing the canvas trim: entry 107,742 B, startup 170,436 B,
canvasFirstView 374,552 B and Live session 127,682 B. Startup grows 48 B and canvasFirstView 62 B against
the merge base, a combined 110 B within the 150 B acceptance limit.
