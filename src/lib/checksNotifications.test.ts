import { afterEach, expect, it, vi } from "vitest";
import { installCheckNotifications, waitForCheckCompletion } from "../../tests/e2e/checks-notifications";

afterEach(() => vi.unstubAllGlobals());

function notifications(controlled: boolean) {
  const messages: (() => void)[] = [];
  let busy = true;
  let channels = 0;
  const due = vi.fn();
  const settled = vi.fn(() => busy);
  const stats = { started: 0, skipped: 0, finished: 0 };
  vi.stubGlobal("window", { __checks: stats, __checkDue: due, __checkSettled: settled });
  vi.stubGlobal(
    "MessageChannel",
    class {
      constructor() {
        channels++;
      }
      port1 = { onmessage: undefined as (() => void) | undefined };
      port2 = { postMessage: () => messages.push(() => this.port1.onmessage?.()) };
    },
  );
  installCheckNotifications(controlled);
  return {
    stats,
    due,
    settled,
    messages,
    setBusy: (value: boolean) => {
      busy = value;
    },
    channels: () => channels,
  };
}

it("announces completion after scheduler cleanup rather than from inside the result callback", () => {
  const n = notifications(true);
  n.stats.started++;
  expect(n.due).toHaveBeenCalledTimes(1);
  expect(n.messages).toHaveLength(0);
  n.stats.finished++;
  expect(n.due).toHaveBeenCalledTimes(1);
  expect(n.settled).not.toHaveBeenCalled();
  expect(n.messages).toHaveLength(1);
  n.setBusy(false);
  n.messages.shift()?.();
  expect(n.settled).toHaveReturnedWith(false);
  expect(n.stats.finished).toBe(1);
});

it("announces held work as due and settled without inventing a finished check", () => {
  const n = notifications(true);
  n.stats.skipped++;
  expect(n.due).toHaveBeenCalledTimes(1);
  expect(n.settled).not.toHaveBeenCalled();
  n.setBusy(false);
  n.messages.shift()?.();
  expect(n.settled).toHaveReturnedWith(false);
  expect(n.stats.finished).toBe(0);
});

it("keeps completion notifications outside the real-CPU measurement mode", () => {
  const n = notifications(false);
  n.stats.started++;
  n.stats.skipped++;
  n.stats.finished++;
  expect(n.due).toHaveBeenCalledTimes(2);
  expect(n.channels()).toBe(0);
  expect(n.messages).toHaveLength(0);
});

it("does not lose completion while the pending read is in flight", async () => {
  let finishRead!: (value: boolean) => void;
  let signal!: () => void;
  const firstRead = new Promise<boolean>((resolve) => {
    finishRead = resolve;
  });
  const read = vi
    .fn()
    .mockImplementationOnce(() => firstRead)
    .mockResolvedValue(false);
  const next = () =>
    new Promise<void>((resolve) => {
      signal = resolve;
    });
  const done = waitForCheckCompletion(read, next);
  signal();
  finishRead(true);
  await done;
  expect(read).toHaveBeenCalledTimes(2);
});

it("rechecks pending work after a stale completion signal", async () => {
  let signal!: () => void;
  const states = [true, true, false];
  const next = () =>
    new Promise<void>((resolve) => {
      signal = resolve;
    });
  const read = vi.fn(async () => {
    const pending = states.shift()!;
    if (pending) queueMicrotask(() => signal());
    return pending;
  });
  await waitForCheckCompletion(read, next);
  expect(read).toHaveBeenCalledTimes(3);
});
