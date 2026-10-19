## UX review

Static designer-agent review passed against the UX principles. No controls were added. Preview retains its explicit Edit entry points and keyboard scroll region, while hidden fields leave the tab order. Annotation links are reachable from their canvas node and return to canvas navigation after the final link. Native link activation stays available.

Length-limited transformations preserve content and selection. Composition is checked before Escape and formatting. Tooltips choose a side from their measured height, clamp both axes and respond to image/layout resizing. Persistence, clearing and export measurement have dedicated browser regressions.

Browser execution is subject to the shared gate budget; a busy gate is reported rather than bypassed. No assertion or timeout was loosened.
