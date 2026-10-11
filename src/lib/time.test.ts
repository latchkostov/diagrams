import { expect, it } from "vitest";
import { formatAgo } from "./time";

it("formats edit times in words", () => {
  const now = Date.UTC(2026, 9, 11, 12);
  expect(formatAgo(now - 10_000, now)).toBe("just now");
  expect(formatAgo(now - 5 * 60_000, now)).toBe("5 min ago");
  expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
  expect(formatAgo(now - 30 * 3_600_000, now)).toBe("yesterday");
  expect(formatAgo(now - 9 * 86_400_000, now)).toMatch(/\d/);
  expect(formatAgo(now + 60_000, now)).toBe("just now");
});
