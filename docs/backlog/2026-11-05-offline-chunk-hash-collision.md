## Offline chunk-name assertion matches content hashes

PR #437's Linux failure is a planning chunk named `assets/ui-BciROoM5.js`.
The offline build contains no collaboration modules; `/room/i` matches `ROoM`
inside the generated content hash. The build graph identifies only planning UI
and chart modules in this chunk, with no collaboration import chain.

The fix round retains both exclusion assertions and their matching rules, as
requested. Failure diagnostics now expose matching filenames and module IDs
instead of an opaque bundler object. Follow up by distinguishing semantic chunk
names from generated hashes, with collision and genuine-room regression cases,
while preserving the independent collaboration-module and endpoint exclusions.
