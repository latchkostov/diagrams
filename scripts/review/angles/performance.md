Angle: PERFORMANCE. Unnecessary React re-renders (missing memoization, unstable props/context values),
work done per frame or per keystroke that should be cached, O(n²) in routing/simulation/geometry,
layout thrash (DOM reads in loops), large allocations in hot paths, bundle size and code-splitting,
images/icons loading. Quantify where you can (e.g. "runs per pointer move for every edge"). Apply the
common P1 rubric: normal-use user-visible regressions need a concrete trigger and evidence. Resource
bounds are P1 only with an untrusted entry point AND superlinear or unbounded memory/time; otherwise
P2. Missing memoization, linear finite work and speculative caps are not P1 by themselves. Never run
benchmarks or broad tests in a review session. In delta rounds only assess old P1s and new fix bugs.
