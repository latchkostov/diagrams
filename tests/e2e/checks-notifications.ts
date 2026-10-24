/** Serialized into the page. A posted message observes scheduler cleanup after its promise microtasks. */
export function installCheckNotifications(controlled: boolean) {
  const page = window as unknown as {
    __checks: Record<"started" | "skipped" | "finished", number>;
    __checkDue(): void;
    __checkSettled(): void;
  };
  // CPU measurements keep their existing probe: completion notification is for the frozen-clock render test.
  const channel = controlled ? new MessageChannel() : undefined;
  if (channel) channel.port1.onmessage = () => page.__checkSettled();
  const keys = controlled ? (["started", "skipped", "finished"] as const) : (["started", "skipped"] as const);
  for (const key of keys) {
    let value = page.__checks[key];
    Object.defineProperty(page.__checks, key, {
      enumerable: true,
      get: () => value,
      set: (next: number) => {
        value = next;
        if (key !== "finished") page.__checkDue();
        if (key !== "started") channel?.port2.postMessage(null);
      },
    });
  }
}

/** Subscribe before reading so completion cannot fall between the state read and the wait. */
export async function waitForCheckCompletion(readPending: () => Promise<boolean>, nextSignal: () => Promise<void>) {
  for (;;) {
    const signal = nextSignal();
    if (!(await readPending())) return;
    await signal;
  }
}
