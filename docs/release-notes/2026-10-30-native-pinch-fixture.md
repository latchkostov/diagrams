## Native E2E pinch gestures use consistent relative zoom

The chip-tier stability test now accounts for React Flow's tenfold Ctrl-wheel pinch gain on macOS, matching the existing zoom helper. It keeps the expected mid tier, one publication after settlement, and reuse through pan, with the same fake-clock steps and assertions.

A regression advertises both Mac platform and user agent on Windows so the helper and React Flow take the same Mac path. Removing the delta normalization makes both Mac-path executions report far instead of mid, while both native Windows executions pass. Restoring it passes all four executions. Product gesture handling and output goldens are unchanged.
