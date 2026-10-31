## Native tutorial clock verification

The rate-limit tutorial regression now advances its installed fake clock until the authored simulation endpoint, then still asserts exactly 10,000 ms and the required readout before completion. A native Windows reproduction stopped at 9,980 ms after a fixed ten-second clock advance because the last animation frame had not reached the endpoint.

This changes test choreography only. No timeout, assertion or output golden changes.
