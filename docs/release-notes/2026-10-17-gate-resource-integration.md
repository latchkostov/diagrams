## Container caps and shared gate admission

Rebased the shared gate budget onto the slow-machine robustness work. `--cpus` and `--memory`
retain their Docker cap meanings and validation. Automatic workers respect both caps before
admission; an explicit `--workers` still overrides automatic sizing. The budget charges the greater
of workers and rounded-up container CPUs, or the worker count when `--cpus` is omitted.

Container caps compose with bounded waits, workers, shards, repetitions, categories and ports.
Both branches' tests are retained, including a combined CPU/memory/max-wait regression.
PR CI is the full gate and runs with zero retries. No app output or parity golden changes are intended.
