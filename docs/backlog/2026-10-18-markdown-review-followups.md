## Annotation link navigation

Route annotation links through the existing pending-target-aware canvas navigation controller. Represent link destinations in logical focus so two queued Tabs visit the next annotation’s links and Tab followed by Shift+Tab supersedes the earlier scheduled move. Add deterministic tests before advancing animation frames. This exceeds the final fix’s ten-line P2 scope.

## Decreasing-indent mixed list coverage

Replace serialized-label assertions with explicit unordered and ordered AST branches, then render MarkdownView and assert both nested lists, source order, and ordered-list semantics. Include a deliberate regression removing subLists rendering. Full structural and rendering coverage exceeds the final fix’s ten-line P2 scope.

## Windows full-run modifier-test timeout

The native Windows unit run on this fix reported 11,489 passed, four skipped and one timeout in the unchanged `src/lib/portableModifiers.test.ts` ESLint probe (its existing 5,000 ms test backstop). The same spec passed both isolated repetitions against clean master `d1b2627fffddff4b579155fc724362ed2a6317db`; this does not establish a pre-existing reproducible failure. Investigate cold ESLint project initialization under full-suite load without weakening its syntax assertions or adding elapsed-time expectations.
