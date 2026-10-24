## PR #283 route-reset fix review

Full layout now returns automatic routes after moving nodes, matching the app and the skill's
documented behavior. Fixed attachment sides and authored metadata remain intact; a layout that is
skipped keeps its existing bends. This fixes stale routes without adding controls or UI text.
