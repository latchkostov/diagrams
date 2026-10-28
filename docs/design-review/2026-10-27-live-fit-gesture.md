## Live fit gesture review

The canvas's documented read-only behavior in Live and Present now applies to node
dragging, click connections and handle connections. Selecting a node still opens
Properties; Edit retains the existing editing gestures. No controls or chrome were
added. Desktop and phone regression coverage uses the same caption/transport layout
as the CI failure and requires readiness after a programmatic Fit.

Do not clear a legitimate gesture hold or shorten a settle to satisfy readiness:
the fix prevents an editing gesture from starting in a viewing mode.
