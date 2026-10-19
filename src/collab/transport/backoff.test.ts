import { expect, it } from "vitest";
import { reconnectDelay } from "./backoff";

it("backs off exponentially, caps at two minutes, and jitters each attempt", () => {
  const low = () => new Uint8Array([0]);
  const high = () => new Uint8Array([255]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const base = Math.min(120_000, 1000 * 2 ** attempt);
    expect(reconnectDelay(attempt, low)).toBe(base / 2);
    expect(reconnectDelay(attempt, high)).toBe(base);
  }
});
