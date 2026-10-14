import { afterEach, describe, expect, it } from "vitest";
import { state } from "./index";
import { formatDate, formatDuration, formatList, formatNumber, formatPercent, formatRate } from "./format";

// Numbers, units, rates, percentages, dates and lists in the current language (./format.ts), all through Intl.

const as = (lang: string) => {
  state.l = lang;
};
afterEach(() => as("en"));
/** Intl groups with a no-break space (or a narrow one): compare as plain spaces. */
const spaces = (s: string) => s.replace(/\s/g, " ");

describe("formatting for the language", () => {
  it("numbers", () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
    as("de");
    expect(formatNumber(1234.5)).toBe("1.234,5");
    as("bg");
    // Bulgarian (like Polish and Spanish) groups from five digits.
    expect(formatNumber(1234.5)).toBe("1234,5");
    expect(spaces(formatNumber(12345.5))).toBe("12 345,5");
    as("hi");
    expect(formatNumber(1234567)).toBe("12,34,567");
    as("ar");
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("percentages and rates", () => {
    expect(formatPercent(0.42)).toBe("42%");
    expect(formatRate(1200)).toBe("1,200 msg/s");
    expect(formatRate(2.5)).toBe("2.5 msg/s");
    as("de");
    expect(spaces(formatPercent(0.42))).toBe("42 %");
    as("fr");
    expect(spaces(formatPercent(0.425, 1))).toBe("42,5 %");
  });

  it("durations in the unit that reads best", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1200)).toBe("1.2 sec");
    as("de");
    expect(spaces(formatDuration(1200))).toBe("1,2 Sek.");
  });

  it("lists", () => {
    expect(formatList(["Kafka", "Postgres", "Redis"])).toBe("Kafka, Postgres, and Redis");
    as("de");
    expect(formatList(["Kafka", "Postgres", "Redis"])).toBe("Kafka, Postgres und Redis");
    expect(formatList(["A", "B"], "or")).toBe("A oder B");
    as("ja");
    expect(formatList(["A", "B", "C"])).toBe("A、B、C");
  });

  it("dates", () => {
    const day = Date.UTC(2026, 9, 12, 12);
    expect(formatDate(day)).toBe("Oct 12");
    as("de");
    expect(formatDate(day)).toBe("12. Okt.");
  });
});
