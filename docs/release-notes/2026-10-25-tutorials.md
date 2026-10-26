## Tutorials are available in production

Open Tutorials beside Diagram and Stencils, from the start card, keyboard shortcuts, Examples
or Ctrl+K. The existing 49 available lessons cover drawing, building blocks, Live, waiting,
resilience and design studies. Each runs on a practice copy; saving a result is explicit.
The checkout repair is included from master. This change adds no lessons or step ids and
does not modify the runner.

Waiting and retry controls now link to their lessons. Related public example cards offer a
Tutorial chip. The Tutorials view and those gallery links are the public showcase for this
release. All 992 tutorial messages, including checkout's, are translated and stamped in all
37 non-English languages. They retain the machine-translation notice.

## Production and review

Tutorial UI and lesson data remain lazy behind tutorial.app and tutorial.list. Command titles
load with Ctrl+K rather than startup. The existing canvas-shared rule keeps the lazy-surface
and machine runtime together; no budget is raised. The production build works at
/tools/diagrams/?view=tutorials and keeps window.__tutorial restricted to development/E2E.
The [UX review](../design-review/2026-10-25-tutorials.md) has no open P1s; P2 follow-ups are
[recorded separately](../backlog/2026-10-25-tutorials.md).

Measured gzip sizes and remaining headroom: entry 108,751 B / 14,749 B; startup 160,198 B /
16,802 B; canvas first view 367,915 B / 15,085 B; Live session 131,611 B / 3,389 B.
The skill ZIP is 817,984 B, below its 835,000 B limit. Canvas first view grows 821 B against
the merge base; all four hard bundle gates pass, with the existing advisory Live warning retained.

## Output parity

Only node/i18n/catalogs.json changes intentionally: its tutorials namespace fingerprints now
reflect translated messages in all 37 languages, and all catalogs include four new English
keys for the chip, its accessible name and the two inspector links. The compiler shares plain
messages by their exact English text, so previously untranslated matching words also change
fingerprints in autoscaling, collab, hover, inspector, planning, resilience, trouble and
workspaceInspector. The pseudo-locale reflects the four new English keys. No other authored
message namespace is edited. Diagram exports, simulation results and browser rendering goldens
are unchanged.
