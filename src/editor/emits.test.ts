import { describe, expect, it } from "vitest";
import { parseEmits } from "./emits";

describe("parseEmits", () => {
  it("empty = unset, plain = one type", () => {
    expect(parseEmits("  ")).toBeUndefined();
    expect(parseEmits("PaymentRequested")).toBe("PaymentRequested");
  });
  it("arrow pairs build a map (→ or ->), * as fallback", () => {
    expect(parseEmits("OrderPlaced → PaymentRequested, * -> Other")).toEqual({
      OrderPlaced: "PaymentRequested",
      "*": "Other",
    });
  });
  it("accepts JSON maps", () => {
    expect(parseEmits('{"A": "B"}')).toEqual({ A: "B" });
  });
  it("incomplete input returns null so the draft is kept", () => {
    expect(parseEmits("A →")).toBeNull();
    expect(parseEmits('{"A": ')).toBeNull();
    expect(parseEmits('{"A": 1}')).toBeNull();
  });
});
