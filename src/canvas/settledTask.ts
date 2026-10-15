/** A task runs only after two rendered samples agree. Missing measurements wait for a signal,
 * rather than a timeout or a frame-count fallback. Document commands run in order before
 * the latest viewport request; only viewport requests can replace each other. */
export function settledTask(
  read: () => string | null,
  frame: (run: () => void) => () => void,
  pending: (value: boolean) => void,
) {
  let task: (() => unknown) | undefined;
  const commands: (() => unknown)[] = [];
  let cancel: (() => void) | undefined;
  let last: string | null = null;
  let version = 0;
  const wake = () => {
    if ((!task && !commands.length) || cancel) return;
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
      const command = commands.shift();
      const run = command ?? task!;
      if (!command) task = undefined;
      const own = ++version;
      last = null;
      void Promise.resolve(run()).then(() => {
        if (own === version && !commands.length && !task) pending(false);
      });
      // Do not wait for a viewport animation's promise before running the next command:
      // React Flow may leave that promise unresolved when a drag interrupts its transition.
      wake();
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
    enqueue(run: () => unknown) {
      version++;
      commands.push(run);
      last = null;
      pending(true);
      wake();
    },
    dispose() {
      version++;
      task = undefined;
      commands.length = 0;
      cancel?.();
      cancel = undefined;
      pending(false);
    },
  };
}
