## Room roster rejection work review

No controls, copy, layout or interaction changes. Room diagnostics keep exact refusal counts while notifying
subscribers once per malformed roster message. This avoids repeated main-thread work from hostile input and
keeps the existing room status and recovery surfaces responsive. Unchanged diagnostic snapshots retain their
identity; relevant changes still refresh them before notifying subscribers.
