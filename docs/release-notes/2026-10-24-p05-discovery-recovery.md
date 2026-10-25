## Discovery recovery and Lab descriptions

Browse examples now offers Retry inside the gallery when its discovery download fails. Tab reaches
it within the dialog; retrying keeps the search and feature filter and restores lost focus to search.
The shared toast still recovers discovery on the start card. The lazy Lab catalog again carries every
public example description, including sidebar tooltips, header copy and description-based search.

Gallery content and accessibility checks wait for all public cards. Export coverage now keeps
discovery mounted and held until SVG and Interactive HTML downloads finish, then checks that discovery
chrome is absent. Blank diagrams still reject image export, so the SVG case keeps the gallery mounted
over an existing diagram; HTML uses the blank start card.

## Output and verification

No golden files changed. This fix round runs only the requested test families; full-suite and parity
execution remain with PR CI. No bundle budget was raised and no example content was removed.

Production gzip level 9: startup is 159,240 B against its fixed 177,000 B limit, leaving 17,760 B
(target: at least 8,192 B). Canvas first view is 363,827 B against 383,000 B, leaving 19,173 B
(target: at least 16,384 B). Both reserves remain above their targets.
