import { describe, expect, it } from "vitest";
import { insertSpoken, isFatalSpeechError, mergeResults, speechErrorKind, speechErrorMessage } from "./dictation";

const final = (transcript: string) => ({ isFinal: true, transcript });
const interim = (transcript: string) => ({ isFinal: false, transcript });

describe("insertSpoken", () => {
  it("writes at the caret with spaces around the words", () => {
    expect(insertSpoken({ value: "", caret: 0 }, " a kafka topic ")).toEqual({ value: "A kafka topic", caret: 13 });
    expect(insertSpoken({ value: "Add", caret: 3 }, "a queue")).toEqual({ value: "Add a queue", caret: 11 });
    // In the middle of text: a space on both sides, caret after the words.
    expect(insertSpoken({ value: "Add queue", caret: 4 }, "a dead letter")).toEqual({
      value: "Add a dead letter queue",
      caret: 17,
    });
  });

  it("capitalises after a full stop, not mid-sentence, and keeps punctuation tight", () => {
    expect(insertSpoken({ value: "One topic.", caret: 10 }, "then a worker").value).toBe("One topic. Then a worker");
    expect(insertSpoken({ value: "Topic, worker", caret: 5 }, "and").value).toBe("Topic and, worker");
  });

  it("ignores silence", () => {
    const t = { value: "x", caret: 1 };
    expect(insertSpoken(t, "   ")).toBe(t);
  });

  it("clamps a stale caret", () => {
    expect(insertSpoken({ value: "ab", caret: 99 }, "c")).toEqual({ value: "ab c", caret: 4 });
  });
});

describe("mergeResults", () => {
  it("shows interim words without writing them", () => {
    const out = mergeResults({ value: "", caret: 0, committed: 0 }, [interim("a kafka")]);
    expect(out).toEqual({ value: "", caret: 0, committed: 0, interim: "a kafka" });
  });

  it("writes final results once, in order, and keeps the rest as interim", () => {
    let s = mergeResults({ value: "", caret: 0, committed: 0 }, [final("a kafka topic"), interim(" orders")]);
    expect(s).toMatchObject({ value: "A kafka topic", committed: 1, interim: "orders" });
    // The same final again (the browser resends the whole list) isn't written twice.
    s = mergeResults(s, [final("a kafka topic"), final(" orders created"), interim(" consumed")]);
    expect(s).toMatchObject({ value: "A kafka topic orders created", committed: 2, interim: "consumed" });
  });

  it("writes at the caret, even after the person moved it", () => {
    const s = mergeResults({ value: "Kafka. Postgres", caret: 6, committed: 0 }, [final("then a worker")]);
    expect(s.value).toBe("Kafka. Then a worker Postgres");
    expect(s.caret).toBe("Kafka. Then a worker".length);
  });

  it("starts counting again after a restart (a new session's list starts at zero)", () => {
    const before = mergeResults({ value: "", caret: 0, committed: 0 }, [final("first part")]);
    expect(before.committed).toBe(1);
    // Restarted on the silence timeout: committed resets, the new list has its own index 0.
    const after = mergeResults({ ...before, committed: 0 }, [final("second part")]);
    expect(after.value).toBe("First part second part");
    expect(after.committed).toBe(1);
  });

  it("waits for an earlier interim result before settling a later final", () => {
    const s = mergeResults({ value: "", caret: 0, committed: 0 }, [interim("still"), final("done")]);
    expect(s).toMatchObject({ value: "", committed: 0, interim: "stilldone" });
  });

  it("keeps working after the box was cleared for the next turn", () => {
    const s = mergeResults({ value: "", caret: 0, committed: 2 }, [final("a"), final("b"), final("next change")]);
    expect(s).toMatchObject({ value: "Next change", committed: 3 });
  });
});

describe("speech errors", () => {
  it("maps codes to friendly, actionable words", () => {
    expect(speechErrorKind("not-allowed")).toBe("denied");
    expect(speechErrorKind("service-not-allowed")).toBe("denied");
    expect(speechErrorKind("no-speech")).toBe("no-speech");
    expect(speechErrorMessage("denied")).toMatch(/blocked/);
    expect(speechErrorMessage("aborted")).toBeNull();
    expect(isFatalSpeechError("denied")).toBe(true);
    expect(isFatalSpeechError("no-speech")).toBe(false);
  });
});
