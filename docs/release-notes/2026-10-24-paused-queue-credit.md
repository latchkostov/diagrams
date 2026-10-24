## Paused callers retain their remaining waves (PR #282)

A sampled blocking caller now receives downstream queue credit only when it stayed active throughout
that queue interval. If it paused at any point, the request receives no queue credit and its remaining
represented waves keep holding the caller's thread after the reply. This prevents premature admission
after resume without introducing interval arithmetic.

Regression coverage also checks that joined one-slot processors credit overlapping queue time once.
The earlier automatic-scale turnover regression remains pinned at 662 scale-one completions versus
670 sampled completions. No parity goldens were changed in this fix round; the independent sweep
is delegated to the orchestrator as requested.
