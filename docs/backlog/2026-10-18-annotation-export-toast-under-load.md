## Annotation export toast under Linux load

The Live authoring bundle refactor's eight-worker Linux neighbour run saw one failure in repeat 2:
`annotations.spec.ts:524` could not find the `Exported` toast after `download.saveAs()` in
“export JSON and import it back keeps every annotation”. The other completed repeats passed,
including all fault-drill and latency tests. No annotation, export or notification code changed.

Following the verification budget, ran only `annotations.spec.ts` twice on a clean checkout of
`origin/master` (`16568b67a91d32e89a7b47d0809406545e3250df`), in Linux with four workers while
the eight-worker neighbour run continued. Both passed; this does **not** establish a reproduced
pre-existing failure. Investigate whether a transient notification can expire while the download
is saved under load, keeping the export/import and annotation assertions intact.

Clean-master result:

```text
SUMMARY: 16568b67a91d32e89a7b47d0809406545e3250df | unit="not run" parity="not run" e2e={"passed":32,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
