## Rail labels, focus and boundary titles

The rail keeps its width, button sizes, icons, font size and controls. Reducing
horizontal button padding from four to two pixels gives captions 56 px instead of
52 px. A real DejaVu Sans reproduction wraps the Greek Tutorials caption into
three lines at 52 px and two at 56 px. No clipping, line clamp, translation change
or smaller type conceals overflow. The existing every-language rail spec measures
the glyphs and still requires at most two lines at desktop and phone widths.

AI's delayed close-focus callback checks the current dock state before restoring
focus. This preserves the most recent open action and the existing closed-panel
focus restoration. There is no additional chrome or setting.

Boundary title bands now survive StrictMode's setup/cleanup replay while fonts
are pending. This prevents a measured drag handle from moving before the press.
The export reset remains intact; the regression checks both the initial band
attribute and its removal for image capture.

The tutorial change concerns only its browser-test clock driver; the learner's
Skip action and application runner remain unchanged. No new simulation, planning
or stencil feature is added, so no new showcase is needed.
