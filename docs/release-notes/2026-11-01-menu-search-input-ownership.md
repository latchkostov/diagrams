## Menu search keeps the keyboard after translation

A search menu whose placeholder changes while open keeps Enter with its focused search field. Updating the translated label no longer restarts the input capture used before the field can take focus.

The regression holds the same mounted menu and changes its placeholder, then requires Enter to pick its highlighted item. Restoring the old effect dependency fails the regression. Full parity passes with all 3,178 goldens unchanged: zero changed, added, missing or stale.
