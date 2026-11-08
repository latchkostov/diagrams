import { afterEach, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { awaitRequestChecks, registerRequestChecks, requestCheckResult } from "./requestCheckCache";
import type { Finding } from "../checks/types";

afterEach(() => registerRequestChecks(undefined));

it("keeps target and whole results distinct and shares a target request", async () => {
  const d = waitingFixture();
  const provider = vi.fn(async (_d, options) => [
    { target: options?.target ?? "whole", requestFinding: {} } as Finding,
  ]);
  registerRequestChecks(provider);
  const [first, second] = await Promise.all([
    awaitRequestChecks(d, { target: "call" }),
    awaitRequestChecks(d, { target: "call" }),
  ]);
  expect(first).toBe(second);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(requestCheckResult(d)).toBeUndefined();
  expect(await awaitRequestChecks(d)).toMatchObject([{ target: "whole" }]);
  expect(provider).toHaveBeenCalledTimes(2);
});

it("cancels one reader without cancelling its sibling, and cancels work when the last reader leaves", async () => {
  const d = waitingFixture();
  const signals: AbortSignal[] = [];
  const finish: (() => void)[] = [];
  registerRequestChecks(
    (_d, options) =>
      new Promise((resolve, reject) => {
        signals.push(options!.signal!);
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason));
        finish.push(() => resolve([]));
      }),
  );
  const a = new AbortController(),
    b = new AbortController();
  const first = awaitRequestChecks(d, { target: "call", signal: a.signal });
  const second = awaitRequestChecks(d, { target: "call", signal: b.signal });
  await Promise.resolve();
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  a.abort();
  await rejected;
  expect(signals[0].aborted).toBe(false);
  finish[0]();
  expect(await second).toEqual([]);
  const c = new AbortController();
  const last = awaitRequestChecks(d, { target: "other", signal: c.signal });
  await Promise.resolve();
  const cancelled = expect(last).rejects.toMatchObject({ name: "AbortError" });
  c.abort();
  await cancelled;
  expect(signals[1].aborted).toBe(true);
});

it.each(["resolve", "reject"])(
  "detaches cancelled attempts synchronously and ignores their late %s",
  async (settlement) => {
    const d = waitingFixture();
    const attempts: { signal: AbortSignal; resolve(value: Finding[]): void; reject(error: Error): void }[] = [];
    registerRequestChecks(
      (_d, options) =>
        new Promise((resolve, reject) => {
          attempts.push({ signal: options!.signal!, resolve, reject });
        }),
    );
    const controller = new AbortController();
    const first = awaitRequestChecks(d, { target: "call", signal: controller.signal });
    await Promise.resolve();
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    expect(requestCheckResult(d, "call")).toBeUndefined();
    const second = awaitRequestChecks(d, { target: "call" });
    await rejected;
    await Promise.resolve();
    expect(attempts).toHaveLength(2);
    expect(attempts[0].signal.aborted).toBe(true);
    expect(attempts[1].signal.aborted).toBe(false);
    if (settlement === "resolve") attempts[0].resolve([{ target: "abandoned", requestFinding: {} } as Finding]);
    else attempts[0].reject(new Error("Abandoned attempt failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(requestCheckResult(d, "call")?.status).toBe("pending");
    const findings = [{ target: "replacement", requestFinding: {} } as Finding];
    attempts[1].resolve(findings);
    expect(await second).toBe(findings);
    expect(await awaitRequestChecks(d, { target: "call" })).toEqual(findings);
  },
);

it("does not republish an abandoned result before a replacement starts", async () => {
  const d = waitingFixture();
  let finish!: (findings: Finding[]) => void;
  // A provider may finish after cancellation instead of rejecting it.
  registerRequestChecks(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const reader = awaitRequestChecks(d, { target: "call", signal: controller.signal });
  const pending = requestCheckResult(d, "call");
  if (pending?.status !== "pending") throw new Error("Expected a pending attempt");
  await Promise.resolve();
  const rejected = expect(reader).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  finish([{ target: "abandoned", requestFinding: {} } as Finding]);
  await pending.done;
  expect(requestCheckResult(d, "call")).toBeUndefined();
});
