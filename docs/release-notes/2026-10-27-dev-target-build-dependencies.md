## Dev-target Playwright setup

Dev-target CI shards now build and verify the production artifact needed by framed-header
tests. Playwright and CI share the required build-profile selection, so a clean checkout
does not depend on output from an earlier run. Product behavior and parity goldens are unchanged.
