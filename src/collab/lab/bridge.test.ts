import { expect, it, vi } from "vitest";
import { FakeClock } from "../clock";
import { COLLAB_LIMITS } from "../limits";
import { labBridge, type LabPacket } from "./bridge";

it("expires crashed local peers without a goodbye, bounds identities and stops the heartbeat on close", () => {
  const clock = new FakeClock();
  let receive: (packet: LabPacket) => void = () => {};
  const post = vi.fn(),
    stop = vi.fn();
  const t = labBridge(
    {
      post,
      subscribe: (fn) => {
        receive = fn;
        return stop;
      },
    },
    clock,
  );
  const leave = vi.fn();
  t.subscribe({ join: () => {}, leave, frame: () => {} });
  for (let i = 0; i < COLLAB_LIMITS.maxSenders + 3; i++) receive({ from: `peer${i}`, kind: "hello" });
  expect(t.peers()).toHaveLength(COLLAB_LIMITS.maxSenders);
  clock.advance(COLLAB_LIMITS.presenceTtlMs);
  expect(t.peers()).toEqual([]);
  expect(leave).toHaveBeenCalledTimes(COLLAB_LIMITS.maxSenders);
  receive({ from: "reopened", kind: "hello" });
  expect(t.peers()).toEqual(["reopened"]);
  t.suspend();
  expect(t.peers()).toEqual([]);
  post.mockClear();
  clock.advance(COLLAB_LIMITS.presenceHeartbeatMs);
  expect(post).not.toHaveBeenCalled();
  t.resume();
  expect(post).toHaveBeenCalledWith({ from: t.self, kind: "hello" });
  t.close();
  expect(stop).toHaveBeenCalledOnce();
  post.mockClear();
  clock.advance(COLLAB_LIMITS.presenceTtlMs);
  expect(post).not.toHaveBeenCalled();
});
