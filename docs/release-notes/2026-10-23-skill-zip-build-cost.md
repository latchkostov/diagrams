## Faster skill ZIP builds

Restore five Zopfli search iterations with unrestricted block splitting for every skill entry,
including the viewer and icon catalog. Remove the expensive large-entry search and its cache.
The shared viewer build now excludes the editing action catalog, including saved-route authoring
and reset menus; both Interactive HTML and the platform viewer retain the router and shaped-route
renderer. No download cap or test timeout changes.

The regenerated skill ZIP is 826,694 bytes (835,000-byte cap). Its determinism test, which builds
the ZIP twice, took 14.47 seconds under local V8 coverage after syncing master. No parity goldens change: exported
payloads, rendered routes and images remain the same; compiled viewer code is normalized by parity.
