## Tutorial integration fixes

Merged master into the tutorial branch, including load shedding and the latest bundle and CI changes.
Opening another diagram while a password link decrypts now keeps the original prompt session, drops the
stale result and explains why. Shared-link callbacks remain stable across navigation and tutorial renders.

The shortcuts regression now checks the Tutorials link in both directions through the focus trap,
Tab and Shift+Tab contents, Escape and restoration of focus to the invoking control. The new link
remains keyboard accessible.

## Output parity

Only `tests/parity/goldens/node/i18n/catalogs.json` was re-recorded after resolving the merge. It includes
the branch's tutorial messages alongside master's catalog: 15 additional messages per locale, 13 more
English fallbacks per translated locale and updated tutorial-area hashes. Other goldens come directly
from the merge; none were re-recorded for these fixes.
