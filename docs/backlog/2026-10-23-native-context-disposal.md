## Native browser context teardown during insertion tests

The dot-attachment review's native dev three-repeat run finished with 385 passed, two failed and
three skipped. Both failures reported `Tearing down "context" exceeded the test timeout of 30000ms`
after the test body, in the existing `flow-building.spec.ts` cases:

- “a node held over an edge lights it up; dropped, it goes in between, keeping the edge's meaning”
- “passing over an edge, or dropping with Ctrl/Cmd held, doesn't insert”

Running only these cases twice on clean master `dd389319082e1084bd82fc491883593851585457`
passed all four tests. The teardown timeouts did not reproduce on master, so their cause remains
unresolved. A focused three-repeat run of the same cases on the reviewed branch subsequently
passed all six tests. Investigate native Chromium context/trace disposal after these insertion fixtures.
Do not raise timeouts, add retries or weaken assertions. All new gesture regressions passed their
three dev repetitions; the Linux load gate passed all 995 tests across five repetitions.

Earlier verification attempts also exposed orchestration mistakes: simultaneous builds replaced
assets being served by another run, and simultaneous reporters shared trace output directories.
Those attempts were stopped. Replacement runs use one immutable build and separate output paths.
