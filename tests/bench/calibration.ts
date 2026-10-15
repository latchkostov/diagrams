// The same-run calibration workload (docs/BENCHMARKS.md § Noise control). A fixed, deterministic mix of what the
// app's hot paths do (integer arithmetic, sorting, Map lookups, string building and JSON), timed in the same process
// (Node) or page (Chromium, at the same CPU throttle) as the benchmarks. A result divided by it ("calibration units")
// compares across machines and CI runners: a runner twice as slow takes about twice as long for both.
//
// Self-contained on purpose: the browser benchmarks pass it to page.evaluate, which sends its source text.

/** One unit of calibration work. Returns a checksum so nothing is optimised away. */
export function calibrationWork(): number {
  const n = 40_000;
  const a: number[] = new Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    a[i] = (seed >>> 8) % 1_000_003;
  }
  a.sort((p, q) => p - q);
  const m = new Map<string, number>();
  for (let i = 0; i < n; i++) m.set(`k${a[i] % 7_919}`, i);
  let sum = 0;
  for (let i = 0; i < n; i += 3) sum += m.get(`k${i % 7_919}`) ?? 0;
  const rows: { id: string; x: number; tags: string[] }[] = [];
  for (let i = 0; i < 4_000; i++) rows.push({ id: `node-${i}`, x: a[i], tags: [`t${i % 13}`, `g${i % 7}`] });
  const text = JSON.stringify(rows);
  const back = JSON.parse(text) as typeof rows;
  return sum + back.length + text.length;
}

/** Median milliseconds of `calibrationWork` over `runs` timed runs, after `warmup` untimed ones. */
export function calibrate(runs = 21, warmup = 5): { ms: number; runs: number[] } {
  for (let i = 0; i < warmup; i++) calibrationWork();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    calibrationWork();
    times.push(performance.now() - t);
  }
  const sorted = [...times].sort((p, q) => p - q);
  return { ms: sorted[Math.floor(sorted.length / 2)], runs: times };
}
