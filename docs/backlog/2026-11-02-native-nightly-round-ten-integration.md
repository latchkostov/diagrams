## Master integration

Master 3eaf1c3c5 contains #424 and #425. The only merge conflict is the generated viewer template.
`pnpm regen` rebuilds it from the integrated source and reports zero i18n errors. Source merges
retain palette menu dismissal, character-key naming and direct Inspector traversal. No rebase or
force push is used.

Only `node/i18n/catalogs.json` changes through this upstream merge: #424's sixteen new selection
messages in 37 locales and two existing boundary announcements moved into the optional selection
catalog alter the counts/fingerprints. The existing upstream golden is retained without editing
or re-recording it. The native fixes change no additional output golden.

## Integrated verification

The merged working tree passes 1,666 focused units, including all 32 startup/reserve heavy
checks, production build and size, and full parity: 3,178 goldens unchanged. The fixes' browser
specs, affected keyboard lessons, upstream keyboard-selection/readiness cases, Checks simulations
and relay sharing pass twice in Linux with six workers sharing four CPUs: 176 production and
four Dev executions, zero failures, flakes or skips. Every previously interrupted case finishes
in each repeat. This is local integration verification; hosted native results require the dispatch.

```text
SUMMARY: 0a51cdef1a2093540dff1a87eaeb7437b5743455 | unit={"passed":1666,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":180,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The quick gate's SHA is the starting HEAD with the upstream merge present in the working tree;
it is not a committed-head stamp. Final static checks precede the signed merge commit.
