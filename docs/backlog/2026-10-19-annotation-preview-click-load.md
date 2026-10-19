## Annotation description preview click under load

During Follow-ups 13 review verification, the fifth Linux load repeat failed the unchanged
`annotations.spec.ts` test “renders markdown and supports formatting shortcuts in diagram description,
text, and note annotations”. At line 698, the description preview remained mounted after its click
(`inspector-field-description-rendered`: expected 0, received 1). Four earlier repeats passed.
The five-repeat run used eight workers and eight CPUs across trace and the annotation, drawing,
viewport, platform and Inspector neighbours: 689 passed, 1 failed, 0 flaky.

The required one-off comparison ran only `annotations.spec.ts` twice, also with eight Linux workers
and CPUs, on a clean copy of `origin/master` at `e659ec3372e6b0593fba3913e69aa960917d91d5`.
Both runs passed (64 tests). This does not establish that the failure reproduces on master.
The review fixes affect roster verification, SVG keyboard menu targets, trace request matching and
slow-motion entry; the failing pointer/Markdown path and this annotation spec are unchanged.
Keep the failure visible for a focused follow-up; do not weaken the preview transition assertion.

## Comparison summary

```text
SUMMARY: e659ec3372e6b0593fba3913e69aa960917d91d5 | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
