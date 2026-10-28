## Keep checkpoint capture within the Live reserve

Represent the internal checkpoint graph with a named tuple, like its scalar clock,
so production JavaScript no longer carries the graph's property names. The local
production Live dependency set shrinks from 128,904 to 128,817 B gzip (87 B saved),
below the unchanged 128,856 B reserve threshold. No budgets or reserves changed.

This touches `src/sim` checkpoint representation, with the same captured values,
copying, restore order, byte estimates and engine results. The optional test oracle
slot is omitted in production, preserving its previous field count. No UI changes
or parity golden changes are intended; no goldens were updated.

The checkpoint and Live units, seek-under-pressure tests, reserve build tests and
entry/viewer size checks cover the change. Temporarily restoring the previous
representation fails both the reserve check and the new shipped-property regression.
Shorter property aliases were rejected: they saved only 25 B locally and still
exceeded the reserve. Deferred loading would complicate synchronous capture/restore.
