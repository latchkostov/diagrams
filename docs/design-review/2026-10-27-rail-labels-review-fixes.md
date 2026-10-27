## Rail labels review fixes

The Diagram caption now activates the same return-focus behavior as its icon and keyboard activation.
Accessible names start with the words shown on every rail button in every language, preserving full
descriptions and counts. No controls, layout changes or additional chrome are needed.

The regression checks cover caption clicks and accessible names on both canvas and gallery rails,
including shortened Spanish and French labels. Both fail against the implementation before these
fixes. The existing real-font and clipping guard assertions remain intact.

## Choices

Keep names that already start with the visible caption unchanged to avoid redundant announcements.
Prefix other names with the translated caption in the shared item renderer, rather than editing
individual translations or adding hidden description elements and identifiers to every button.
