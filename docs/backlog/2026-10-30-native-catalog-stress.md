## Native follow-up load evidence

The annotation-input and artwork regressions pass all five repetitions in both follow-up Linux profiles. All runs retain the test deadlines, assertions, tolerances and request bound. The full selected cohort is 35 cases per repetition, including the bundle spec and affected annotation, drawing, viewport, platform and inspector neighbours.

Eight workers on two CPUs / 7 GiB finish with:

```text
SUMMARY: 6b2e16e5a576c7e9092eba9687881c206ef42d2f | unit="not run" parity="not run" e2e={"passed":158,"failed":17,"flaky":0,"skipped":0} gate_failures=5
```

The failures cover bundle-trim's loaded/delayed GroupPanel, searchable-menu comparisons and held-search comparisons. The held typing trace includes opening viewport-settling polls before the pick. These failures remain unresolved; they are not evidence of a platform path or download-location defect.

The established eight-worker, three-CPU / 7 GiB profile finishes with:

```text
SUMMARY: 6b2e16e5a576c7e9092eba9687881c206ef42d2f | unit="not run" parity="not run" e2e={"passed":174,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Only bundle-trim:65's loaded GroupPanel fails, in repetition two: the selected Boundary inspector has no label field within the existing seven-second expectation. The other four repetitions pass all 35 cases. This is not an all-green stress result and is not proven pre-existing by a matching clean-master reproduction.

## Proposed investigation

The boundary trace shows successful GroupPanel and color-picker responses while unrelated gallery/dialog, AI and Live background modules also load. The inspector shell selects Boundary but its content remains absent at the failed expectation. Profile module evaluation and lazy-surface publication alongside the idle preload queue before changing scheduling. Successful responses and concurrent traffic alone do not prove causation. Keep the field-value oracle and its deadline unchanged. Do not infer that the artwork request-count improvement fixes this separate boundary.

Ignored evidence is catalog-linux.log, catalog-standard-linux.log, catalog-failure.zip and catalog-standard-failure.zip under tests/.output/native-nightly. The branch Nightly's remaining native groups are tracked separately in the existing dated reports.
