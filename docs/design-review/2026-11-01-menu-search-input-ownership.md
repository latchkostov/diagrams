## Keyboard ownership

The menu's search field keeps its focus and normal Enter action when its placeholder changes. Pre-focus input buffering still starts when a searchable menu opens and ends through its existing handoff. The capture follows the presence of a search field rather than its translated wording.

No control, chrome, colour, camera rule or visible wording is added. The native replay investigation exposed this independently reproducible ownership bug; the branch Nightly must establish whether any remaining native replay failure shares it.
