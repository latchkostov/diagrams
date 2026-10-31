## Annotation search owns its results

The native Windows failure switched from Library search to the separate Annotate flyout after filling `ellipse`. That flyout intentionally has one Shape tile and cannot contain the ellipse search result. The driver was using a plain visibility read of the Annotate group as permission to switch surfaces.

The search driver now waits for the camera to settle, fills Library search and waits for its actual results. Both the existing sticky-note assertion and exact ellipse-shape assertion remain. A regression supplies a stale group-visibility observation without changing the rendered library or document; it must still add the ellipse through search. No product behavior, tolerance, budget or golden changes.

The Windows cohort passes all 13 cases, including the two annotation cases and the 11 merged keyboard checks. Temporarily restoring the old search driver fails the new regression because the ellipse tile is absent from the separate flyout. Linux runs the same cohort twice against the production build.
