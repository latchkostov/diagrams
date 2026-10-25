## Building blocks tutorials follow the completion contract

Merged master including the path-check and patch support from #318. The five
building blocks lessons use the shared runner without lesson-specific runtime
changes. Show me reveals through the camera without selecting; Skip and Continue
use the runner's check-and-settlement contract.

Config settings now use declarative property paths and patches. Adding the fifth
setting preserves existing entries, and marking it secret preserves a learner's
own key. Repeating either patch makes no further edit. The other four lessons
already fit the merged contract, including the outbox trace action.

The only golden changed relative to master is
`tests/parity/goldens/node/i18n/catalogs.json`: the five lessons add 58 English
messages, increasing catalog and English-fallback counts by 58 and changing each
language's tutorials-area hash. No simulation or visual output change is intended.
