import { describe, expect, it, vi } from "vitest";
import {
  createModelSession,
  languageModel,
  modelAvailability,
  MODEL_LANGUAGES,
  type LanguageModelApi,
} from "./promptApi";

const fake = (availability: () => Promise<string>) =>
  ({
    availability: vi.fn(availability),
    create: vi.fn(async () => ({ prompt: vi.fn(), destroy: vi.fn() })),
  }) as unknown as LanguageModelApi;

describe("feature detection", () => {
  it("finds LanguageModel only when it has availability() and create()", () => {
    const lm = fake(async () => "available");
    expect(languageModel({ LanguageModel: lm })).toBe(lm);
    expect(languageModel({ LanguageModel: { availability() {} } })).toBeUndefined();
    expect(languageModel({})).toBeUndefined();
  });
});

describe("availability", () => {
  it.each(["available", "downloadable", "downloading", "unavailable"])("passes %s through", async (state) => {
    expect(await modelAvailability(fake(async () => state))).toBe(state);
  });

  it("asks with the languages create() uses", async () => {
    const lm = fake(async () => "available");
    await modelAvailability(lm);
    expect(lm.availability).toHaveBeenCalledWith(MODEL_LANGUAGES);
  });

  it("counts a throw, an unknown state or no API as unavailable", async () => {
    expect(await modelAvailability(fake(async () => Promise.reject(new Error("no"))))).toBe("unavailable");
    expect(await modelAvailability(fake(async () => "readily"))).toBe("unavailable");
    expect(await modelAvailability(undefined)).toBe("unavailable");
  });
});

describe("create", () => {
  it("primes the session and reports download progress through monitor", async () => {
    const lm = fake(async () => "downloadable");
    const progress: number[] = [];
    await createModelSession(lm, [{ role: "system", content: "s" }], (p) => progress.push(p));
    const options = vi.mocked(lm.create).mock.calls[0][0]!;
    expect(options.initialPrompts).toEqual([{ role: "system", content: "s" }]);
    expect(options.expectedInputs).toEqual(MODEL_LANGUAGES.expectedInputs);
    const listeners: ((e: { loaded: number }) => void)[] = [];
    options.monitor!({ addEventListener: (_t, l) => listeners.push(l) });
    for (const loaded of [0, 0.4, 1]) listeners.forEach((l) => l({ loaded }));
    expect(progress).toEqual([0, 0.4, 1]);
  });
});
