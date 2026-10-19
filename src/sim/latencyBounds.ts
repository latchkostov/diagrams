// The latency buckets bounds, the powers of 1.12 (k = 0…126), exactly as V8 computes 1.12 ** k, without calling
// Math.pow or ** at run time: those may differ in the last bit between JS engines (WebKit did). Each bound is the
// running product 1.12 × 1.12 × … (IEEE multiplication, exactly rounded in every engine), moved by the few units in
// the last place that V8's pow differs by, recorded below. src/sim/determinism.test.ts checks every value.

/** Per k, how many units in the last place V8's 1.12 ** k lies from the running product, plus 2 (so 0…4). */
const ULPS =
  "2222222222222222223222211111111212221110011221111211222322222222121222222221111012222222333333444433333433323333323333333332222";

const bits = new DataView(new ArrayBuffer(8));

/** A positive double moved by `units` representable values (`units` small): integer arithmetic on its bits. */
function nudge(value: number, units: number): number {
  if (!units) return value;
  bits.setFloat64(0, value);
  let high = bits.getUint32(0);
  let low = bits.getUint32(4) + units;
  if (low > 0xffffffff) {
    low -= 0x100000000;
    high++;
  } else if (low < 0) {
    low += 0x100000000;
    high--;
  }
  bits.setUint32(0, high);
  bits.setUint32(4, low);
  return bits.getFloat64(0);
}

/** POWERS[k] = 1.12 ** k as V8 computes it: bucket k + 1 holds latencies in (POWERS[k - 1], POWERS[k]] ms. */
export const POWERS: readonly number[] = (() => {
  const out: number[] = [];
  let product = 1;
  for (let k = 0; k < ULPS.length; k++) {
    out.push(nudge(product, ULPS.charCodeAt(k) - 50));
    product *= 1.12;
  }
  return out;
})();
