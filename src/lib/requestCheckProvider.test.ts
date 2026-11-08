import { afterEach, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import type { CheckRequest, CheckResponse } from "../checks/worker";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("the production registration forwards targets beyond the real cutoff and cancellation to the worker", async () => {
  vi.resetModules();
  const posted: CheckRequest[] = [];
  let deliver!: (message: CheckResponse) => void;
  let arrived: (() => void) | undefined;
  let hold = false;
  const scope = {
    onmessage: null as null | ((e: { data: CheckRequest }) => void),
    postMessage: (data: CheckResponse) => queueMicrotask(() => deliver(data)),
  };
  class ChecksWorker {
    onmessage?: (event: { data: CheckResponse }) => void;
    constructor() {
      deliver = (data) => this.onmessage?.({ data });
    }
    postMessage(message: CheckRequest) {
      posted.push(message);
      if (!hold || "cancel" in message) scope.onmessage!({ data: message });
      arrived?.();
    }
  }
  vi.stubGlobal("Worker", ChecksWorker);
  vi.stubGlobal("self", scope);
  await import("../checks/worker");
  const { registerRequestChecks } = await import("./requestCheckProvider");
  const { registerEditorRequestChecks } = await import("./registerEditorRequestChecks");
  const { awaitRequestChecks, requestCheckResult } = await import("./requestCheckCache");
  const diagram = waitingFixture();
  // Long public fixture labels amplify real output accounting, without replacing or lowering its bound.
  diagram.nodes[1].label = "Caller ".repeat(28);
  diagram.nodes[2].label = "Partner ".repeat(24);
  diagram.edges = Array.from({ length: 1500 }, (_, i) => ({
    id: `call-${i}`,
    from: "caller",
    to: "partner",
    kind: "sync" as const,
  }));
  registerEditorRequestChecks();
  try {
    const whole = await awaitRequestChecks(diagram);
    const target = "call-1499";
    expect(whole.some((f) => f.omitted && f.rule === "call-timeout")).toBe(true);
    expect(whole.some((f) => f.id === `call-timeout:${target}`)).toBe(false);
    const scoped = await awaitRequestChecks(diagram, { target });
    expect(scoped.some((f) => f.id === `call-timeout:${target}`)).toBe(true);
    expect(posted.at(-1)).toMatchObject({ target, requests: true });

    hold = true;
    const sent = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const controller = new AbortController();
    const pending = awaitRequestChecks(diagram, { target: "call-1498", signal: controller.signal });
    await sent;
    const id = posted.at(-1)!.id;
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(posted.at(-1)).toEqual({ id, cancel: true });
    expect(requestCheckResult(diagram, "call-1498")).toBeUndefined();
    deliver({ id, target: "call-1498", requestsOnly: [] });
  } finally {
    registerRequestChecks(undefined);
  }
});
