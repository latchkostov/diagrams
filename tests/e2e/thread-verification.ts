import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __threadVerification?: {
      requested: number;
      pending(): number;
      whenSettled(): Promise<void>;
      release?: () => void;
    };
  }
}

/** Installed before navigation: worker execution uses the real clock even when the page clock is paused. */
export function installThreadVerificationInPage({ holdFirst = false }: { holdFirst?: boolean } = {}) {
  const pending = new Map<Worker, Set<number>>();
  const observed = new WeakSet<Worker>();
  const waiters = new Set<() => void>();
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
  const state = (window.__threadVerification = {
    requested: 0,
    pending: () => [...pending.values()].reduce((sum, ids) => sum + ids.size, 0),
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
    const request = message as { id?: number; threadFix?: unknown } | null;
    if (!request?.threadFix || typeof request.id !== "number") return post.call(this, message, transferOrOptions);
    const id = request.id;
    const ids = pending.get(this) ?? new Set<number>();
    ids.add(id);
    pending.set(this, ids);
    state.requested++;
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
