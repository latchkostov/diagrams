## Tutorials production review

Reviewed the Tutorials list, mobile API intro and active steps at 1280 × 800 in English,
Arabic and the 40% expanded pseudo-locale, plus the new example and inspector entry points.
The production subpath test opens a lesson, starts it, exits and changes tabs. Production
does not expose the tutorial test driver. The existing completion machine and focus policy
are unchanged.

## Chrome and plain language

Tutorials adds a tab to the existing view switcher, with no new toolbar control. Cards have
one primary Start/Continue action. Inspector links sit beside the relevant waiting and retry
controls; example cards have one secondary Tutorial chip with an example-specific accessible
name. Lessons run on practice copies, with explicit Save a copy at completion.

Instructions, search terms and authored names use the tutorial message namespace in all 37
translated catalogs, including checkout. Translations follow the existing glossaries and
retain the machine-translation notice. Compound consumer-group messages use narrowly scoped
glossary exceptions for the standalone consumer term, retaining each language's prescribed
compound wording. These are not fluent-speaker approvals.

## Layout, keyboard and screen readers

The list and active strip have no horizontal overflow in the three reviewed languages. Arabic
mirrors the chrome; the canvas remains left to right. Card text wraps, and primary actions
align at the bottom of each row. Intro Start receives focus through the existing dialog policy;
Enter starts the lesson in all three reviewed languages. Tutorials add no focus calls.
Existing headings, progress labels, polite step announcements and labelled controls remain
available to screen readers; highlights convey the same instruction visually without taking
pointer events. The chip's accessible name includes the example title.

English and Arabic retained the 76 px strip through the first four mobile API transitions.
The expanded pseudo-locale's add-api step grew to 82.71875 px before returning to 76 px.
This small layout shift is a P2 follow-up, recorded separately rather than hidden by a relaxed
assertion. Fluent review of technical terminology and example names is also a follow-up.

## Disposition

No open P1 findings. Production navigation, lazy lesson loading and in-place links have
regression coverage. Owner authorization to ship was supplied in the build-12 brief; no
additional approval is pending. Follow-ups: [tutorial polish](../backlog/2026-10-25-tutorials.md).
