## Rail label review

The designer agent's code review found no blocking issue. Short labels retain full tooltip and
accessible names, including Checks warnings and AI unread changes. The change adds no actions or
controls. Logical CSS keeps RTL layout, tablet icons remain compact, and phone secondary actions
remain under More. The phone bar grows by eight pixels to make room for readable labels while
keeping touch targets at least 44 px.

The browser guard measures actual text and button boxes, line count and the 10.5 px font floor in
every language at desktop and narrow phone widths. It checks both editing and gallery rails, so the
return-to-diagram label is covered too. Full glossary names remain unchanged; exceptions apply only
to the short rail labels that require them.

## Choices

Rejected widening the desktop rail, truncating with ellipses, hiding phone labels and shrinking below
10.5 px. These would consume more canvas space or conceal actions. Short translated copy, wrapping
and bounded shrinking preserve the existing rail width and readable action names.

CSS container sizing handles the font reduction. An imperative font-fitting component exceeded the
unchanged canvas headroom budget, so the final version keeps this behavior in CSS and verifies the
actual fonts and every translated label in the browser guard.

Review was by code inspection; measured browser tests provide layout verification.
