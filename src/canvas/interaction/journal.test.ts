import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  { dev: true, e2e: "", enabled: true },
  { dev: false, e2e: "1", enabled: true },
  { dev: false, e2e: "", enabled: false },
])("journals only in development or E2E builds: $dev/$e2e", async ({ dev, e2e, enabled }) => {
  vi.stubEnv("DEV", dev);
  vi.stubEnv("VITE_E2E", e2e);
  const target = {};
  vi.stubGlobal("window", target);
  const { interactionJournal } = await import("./journal");
  const entry = { seq: 1, event: "naming.done", command: "focus:item:c@now" };
  expect(Boolean(interactionJournal)).toBe(enabled);
  interactionJournal?.(entry);
  expect(target).toEqual(enabled ? { __interactionJournal: [entry] } : {});
});
