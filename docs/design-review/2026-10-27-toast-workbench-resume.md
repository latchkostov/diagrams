## Workbench toast integration review

No controls or settings were added. The dock, Add/Annotate flyouts, phone dock and expanded
note sheet retain their existing nonmodal behavior. Page notifications now render in the
Workbench main area's own layer (7), below flyouts and the transport (8) and phone dock (9).
The bezel and body-level menus/dialogs remain above them. Viewers and the tutorial retain
the body-level notification layer, including readability above the tutorial coach's dim.

The root moves only when its host changes, so store publications do not detach a focused
toast. A modal's existing inert sweep covers the host; CSS hides retained notifications
under inherited inertness as well as direct inertness. Task Cancel remains in the body.

The shared dialog registers ownership before autofocus, preserves it across StrictMode
replay, and unregisters after returning focus on actual close. This retains #360's original
opener capture after an outgoing dialog's cleanup. Shortcuts registers before focus too.
Consumed actions expose aria-disabled while remaining focusable until the user leaves them.

Rejected: raising notification z-indexes, which cannot escape Workbench's nested stacking
contexts; treating the phone note as a modal, which would change its interaction contract;
and removing a consumed opener immediately, which loses the modal's focus-return target.

## Regression coverage

Real shared-dialog and shortcuts focus handoffs run with and without StrictMode and a
waiting notification. Moving registration after focus fails all four new cases. Removing
the consumed-action guard fails the store regression; removing its aria-disabled binding
fails the rendering regression. Browser checks exercise repeated recording URL ownership,
palette actions, and hit targets where Workbench surfaces overlap a retained notification.
The note sheet's Escape handler yields to the registered palette and keeps its note open.
