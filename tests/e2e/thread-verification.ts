import type { Page } from "@playwright/test";
import type { ThreadFixRequest } from "../../src/live/threadFixPlan";

declare global {
  interface Window {
    __threadVerification?: {
      requested: number;
      requests: ThreadFixRequest[];
      pending(): number;
      whenRequested(): Promise<void>;
      whenSettled(): Promise<void>;
      release?: () => void;
    };
    __scenarioPlan?: Window["__threadVerification"];
  }
}

/** Installed before navigation: worker execution uses the real clock even when the page clock is paused. */
export function installThreadVerificationInPage({
  holdFirst = false,
  kind = "threadFix",
}: { holdFirst?: boolean; kind?: "threadFix" | "plan" } = {}) {
  const pending = new Map<Worker, Set<number>>();
  const observed = new WeakSet<Worker>();
  const waiters = new Set<() => void>();
  const requestedWaiters = new Set<() => void>();
  let scheduled = false;
  const notify = () => {
    if (scheduled || !waiters.size) return;
    scheduled = true;
    // A task boundary drains the response's promise chain, including a stale flight's latest replacement.
    // Page timers and animation frames may be frozen by the test; MessageChannel still observes real replies.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      scheduled = false;
      if (!state.requested || pending.size) return;
      const ready = [...waiters];
      waiters.clear();
      for (const resolve of ready) resolve();
    };
    channel.port2.postMessage(null);
  };
  const state = (window[kind === "plan" ? "__scenarioPlan" : "__threadVerification"] = {
    requested: 0,
    requests: [] as ThreadFixRequest[],
    pending: () => [...pending.values()].reduce((sum, ids) => sum + ids.size, 0),
    whenRequested: (): Promise<void> =>
      state.requested ? Promise.resolve() : new Promise<void>((resolve) => requestedWaiters.add(resolve)),
    whenSettled: () =>
      new Promise<void>((resolve) => {
        waiters.add(resolve);
        notify();
      }),
    release: undefined as (() => void) | undefined,
  });
  if (typeof Worker !== "function") return;
  const post = Worker.prototype.postMessage as (
    this: Worker,
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ) => void;
  Worker.prototype.postMessage = function (
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ) {
    const request = message as { id?: number; threadFix?: ThreadFixRequest; plan?: boolean } | null;
    if (!request?.[kind] || typeof request.id !== "number") return post.call(this, message, transferOrOptions);
    const id = request.id;
    const ids = pending.get(this) ?? new Set<number>();
    ids.add(id);
    pending.set(this, ids);
    state.requested++;
    for (const resolve of requestedWaiters) resolve();
    requestedWaiters.clear();
    if (request.threadFix) state.requests.push(request.threadFix);
    if (!observed.has(this)) {
      observed.add(this);
      this.addEventListener("message", (event: MessageEvent<{ id?: number }>) => {
        const id = event.data?.id;
        if (typeof id !== "number") return;
        const ids = pending.get(this);
        if (!ids?.delete(id)) return;
        if (!ids.size) pending.delete(this);
        notify();
      });
      this.addEventListener("error", () => {
        pending.delete(this);
        notify();
      });
    }
    const send = () => {
      try {
        post.call(this, message, transferOrOptions);
      } catch (error) {
        ids.delete(id);
        if (!ids.size) pending.delete(this);
        notify();
        throw error;
      }
    };
    if (holdFirst && state.requested === 1) {
      let held = true;
      state.release = () => {
        if (!held) return;
        held = false;
        state.release = undefined;
        send();
      };
      return;
    }
    send();
  };
}

export async function installThreadVerification(page: Page, holdFirst = false) {
  await page.addInitScript(installThreadVerificationInPage, { holdFirst });
}

export async function waitForThreadVerification(page: Page) {
  await page.evaluate(() => {
    if (!window.__threadVerification) throw new Error("Thread-verification probe was not installed before navigation");
    return window.__threadVerification.whenSettled();
  });
}

export async function installScenarioPlan(page: Page, holdFirst = false) {
  await page.addInitScript(installThreadVerificationInPage, { holdFirst, kind: "plan" as const });
}

export async function waitForScenarioPlan(page: Page) {
  await page.evaluate(() => {
    if (!window.__scenarioPlan) throw new Error("Scenario-plan probe was not installed before navigation");
    return window.__scenarioPlan.whenSettled();
  });
}

/** A held request has one release, including when finally drains an already completed setup. */
export function releaseVerificationOnce(release: () => Promise<void>) {
  let released: Promise<void> | undefined;
  return () => (released ??= release());
}
