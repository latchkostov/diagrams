/** Real transformed code, so the counter's self-test covers the injection rather than hand-written increments. */
export function linear(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}

export function quadratic(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum += j;
  return sum;
}

export const callbacks = (n: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 2);
export const trim = (s: string) => s.trim();
export const serialize = (n: number) => JSON.stringify(Array(n).fill("x"));
export const optionalTrim = (node?: { label: string }) => node?.label.trim();
export const optionalSlice = (node?: { label: string }) => node?.label.slice(0, 3).trim();
