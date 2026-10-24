## PR 291 review follow-up

Boundary creation retains the existing keyboard workflow: Ctrl/Cmd+G opens Label with its name selected;
immediate typing replaces it even when GroupPanel is delayed. Membership is published before child layout
effects without adding controls or changing the focus policy. Deleted owners remain canceled.

Validation uses the same editable-property descriptors as the picker. Exact field, unit and limit assertions
cover traffic shapes and all six property choices. The collaboration regression awaits the released inspector
module's readiness, then checks that the annotation editor retains focus and accepts typing.

Rejected removing deleted-owner checks or adding a timing delay: both would weaken the cancellation contract.
