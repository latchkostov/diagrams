## Confluence settings panel review

Reviewed the empty, chosen-file (Options closed and open), and editing states in light and dark
using the fake-bridge production harness. The empty state has one chooser in a dashed drop zone;
the footer explains why Insert is disabled. Once chosen, a 110 px still preview, filename and Change
or Replace file affordance replace the drop zone. Options holds the three secondary decisions.
The footer has one primary commit action and Cancel; uploads occur only after that commit action.

The panel enables Forge theming and consumes Atlassian surface, text, border, brand, selected and
focus tokens, with light/dark fallbacks. Segments expose pressed states and fieldset legends; the
simulation select has an explicit label. Errors are announced and focused, chosen files focus their
card, native select popups consume Escape before the panel, and file selection works with Enter,
Space and drop. Long filenames and open Options fit at 320 px and 160 px without horizontal scroll.

Kept the existing bounded thumbnail geometry instead of embedding another full viewer: it shows
the file's nodes, boundaries and connections without simulation controls or a second runtime.
Rejected immediate upload controls and the page attachment dropdown because they conflict with
the approved two-click flow. No new toolbar, simulation feature or component package is introduced.
