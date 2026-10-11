import { describe, expect, it } from "vitest";
import { KEYWORD_WEIGHT, SCORE, scoreQuery, scoreToken, subsequence, tokens } from "./fuzzy";

describe("fuzzy scoreToken", () => {
  it("ranks exact > prefix > word prefix > acronym > substring > subsequence", () => {
    const exact = scoreToken("fit view", "Fit view");
    const prefix = scoreToken("ren", "Rename node");
    const word = scoreToken("node", "Rename node");
    const acronym = scoreToken("tl", "Toggle live");
    const sub = scoreToken("ayou", "Auto-layout");
    const seq = scoreToken("rnm", "Rename");
    expect(exact).toBe(SCORE.exact);
    expect(prefix).toBe(SCORE.prefix);
    expect(word).toBe(SCORE.wordPrefix);
    expect(acronym).toBe(SCORE.acronym);
    expect(sub).toBe(SCORE.substring);
    expect(seq).toBeGreaterThan(0);
    expect([exact, prefix, word, acronym, sub, seq]).toEqual(
      [exact, prefix, word, acronym, sub, seq].sort((a, b) => b - a),
    );
  });

  it("finds hyphenated and dotted compounds", () => {
    expect(scoreToken("fanout", "AWS order fan-out")).toBeGreaterThan(SCORE.substring);
    expect(scoreToken("drawio", "Export › draw.io")).toBeGreaterThan(SCORE.substring);
  });

  it("is case-insensitive and misses cleanly", () => {
    expect(scoreToken("kafka", "KAFKA Topic")).toBe(SCORE.prefix);
    expect(scoreToken("zzz", "Rename node")).toBe(0);
    expect(scoreToken("", "Rename node")).toBe(0);
  });

  it("prefers earlier words for word-prefix hits", () => {
    expect(scoreToken("boundary", "Add boundary")).toBeGreaterThan(scoreToken("boundary", "Delete the old boundary"));
    expect(scoreToken("nodes", "Delete boundary and nodes")).toBeLessThan(SCORE.wordPrefix);
  });

  it("scores subsequences by tightness and word starts, within 10–40", () => {
    const tight = subsequence("rena", "xrenamex");
    const loose = subsequence("rna", "r---n---a");
    expect(tight).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThanOrEqual(10);
    expect(tight).toBeLessThanOrEqual(40);
    expect(subsequence("ab", "ba")).toBe(0);
    expect(subsequence("sb", "storefront browser")).toBe(0); // two letters need a real prefix or acronym hit
  });
});

describe("fuzzy scoreQuery", () => {
  it("needs every token to match, averaging their scores", () => {
    expect(scoreQuery("rename node", { label: "Rename node" })).toBeGreaterThan(SCORE.prefix);
    expect(scoreQuery("rename edge", { label: "Rename node" })).toBe(0);
  });

  it("matches keywords at a discount", () => {
    const viaLabel = scoreQuery("export", { label: "Export PNG" });
    const viaKeyword = scoreQuery("export", { label: "draw.io", keywords: "Export file" });
    expect(viaKeyword).toBeCloseTo(SCORE.prefix * KEYWORD_WEIGHT);
    expect(viaLabel).toBeGreaterThan(viaKeyword);
  });

  it("ignores scattered letters in keywords", () => {
    expect(scoreQuery("sbq", { label: "Storefront", keywords: "sobriquet" })).toBe(0);
    expect(scoreQuery("sb", { label: "Storefront", keywords: "shopper Browser / mobile checkout" })).toBe(0);
    expect(scoreQuery("brow", { label: "Storefront", keywords: "shopper Browser" })).toBeGreaterThan(0);
  });

  it("matches everything for an empty query", () => {
    expect(scoreQuery("   ", { label: "Anything" })).toBe(1);
    expect(tokens("  Add   Kafka ")).toEqual(["add", "kafka"]);
  });
});
