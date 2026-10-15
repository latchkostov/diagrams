/** A task runs only after two rendered samples agree. Missing measurements wait for a signal,
 * rather than a timeout or a frame-count fallback. A newer request replaces an older one. */
export function settledTask(
  read: () => string | null,
  frame: (run: () => void) => () => void,
  pending: (value: boolean) => void,
) {
  let task: (() => unknown) | undefined;
  let cancel: (() => void) | undefined;
  let last: string | null = null;
  let version = 0;
  const wake = () => {
    if (!task || cancel) return;
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
      const run = task!;
      const own = version;
      task = undefined;
      last = null;
      void Promise.resolve(run()).then(() => {
        if (own === version) pending(false);
      });
    });
  };
  return {
    wake,
    request(run: () => unknown) {
      version++;
      task = run;
      last = null;
      pending(true);
      wake();
    },
    dispose() {
      version++;
      task = undefined;
      cancel?.();
      cancel = undefined;
      pending(false);
    },
  };
}
