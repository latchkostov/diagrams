## Live camera and region titles: review fixes

Following keeps fully visible narrated cards painted at the pane edge, including their identity,
highlight and Live readout, without moving the camera. Zone titles and low-zoom boundary chips
share collision reservations. Imported overlapping regions use a spatial index and one capped
search budget per placement pass, with collision-free stacking above occupied content on exhaustion.
Zone renaming applies its editor scale once on phones and at every zoom. Open editors also
stay inside the pane when a selection reveal moves the camera or changes the pane.

The showcase audit now requires every expected nonempty region title and checks title-to-title
collisions as well as cards and routes. Regression checks deliberately restore each reported bug.
Output parity: all 3,178 goldens are unchanged; none were added, removed or re-recorded.
