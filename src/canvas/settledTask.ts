/** A task runs only after two rendered samples agree. Missing measurements wait for a signal,
 * rather than a timeout or a frame-count fallback. Readiness subscribers are independent
 * of replaceable viewport requests and their interruptible transitions. */
export function settledTask(
  read: () => string | null,
  frame: (run: () => void) => () => void,
  pending: (value: boolean) => void,
) {
  let task: (() => unknown) | undefined;
  const waiters = new Set<() => unknown>();
  let cancel: (() => void) | undefined;
  let last: string | null = null;
  let active: object | undefined;
  const updatePending = () => {
    if (!task && !waiters.size) {
      cancel?.();
      cancel = undefined;
      last = null;
    }
    pending(!!task || !!waiters.size || !!active);
  };
  const wake = () => {
    if ((!task && !waiters.size) || cancel) return;
    cancel = frame(() => {
      cancel = undefined;
      const next = read();
      if (next === null) {
        last = null;
        return;
      }
      if (next !== last) {
        last = next;
        wake();
        return;
      }
      const waiter = waiters.values().next().value;
      const run = waiter ?? task!;
      if (waiter) waiters.delete(waiter);
      else task = undefined;
      const own = {};
      if (!waiter) active = own;
      last = null;
      void Promise.resolve(run()).then(() => {
        if (active === own) active = undefined;
        updatePending();
      });
      // Do not wait for a viewport animation's promise before running the next command:
      // React Flow may leave that promise unresolved when a drag interrupts its transition.
      wake();
    });
  };
  return {
    wake,
    request(run: () => unknown) {
      active = undefined;
      task = run;
      last = null;
      pending(true);
      wake();
    },
    whenReady(run: () => unknown) {
      waiters.add(run);
      last = null;
      pending(true);
      wake();
      return () => {
        waiters.delete(run);
        updatePending();
      };
    },
    interrupt() {
      active = undefined;
      task = undefined;
      last = null;
      updatePending();
    },
    dispose() {
      active = undefined;
      task = undefined;
      waiters.clear();
      cancel?.();
      cancel = undefined;
      pending(false);
    },
  };
}
