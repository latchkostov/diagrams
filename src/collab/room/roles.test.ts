import { describe, expect, it } from "vitest";
import type { PeerPresence } from "../presence";
import { driverOf, rolesOf, rosterOf, successor } from "./roles";

const peer = (sender: string, extra: Partial<PeerPresence> = {}): PeerPresence =>
  ({ sender, alias: sender, colour: 0, status: "active", seen: 0, ...extra }) as PeerPresence;

describe("the room's roles (P3, cooperative)", () => {
  it("the host is whoever claims it (the lowest id of two); its roster names co-hosts and the driver", () => {
    const r = rosterOf({ sender: "b" }, [
      peer("c", { host: true, cohosts: ["b", "gone"], driver: "b" }),
      peer("d", { host: true }),
    ]);
    expect(r).toEqual({ host: "c", cohosts: ["b"], driver: "b" });
    expect(rolesOf(r, "b")).toEqual({ host: false, cohost: true, driving: true });
    // The driver gone: the host drives.
    expect(rosterOf({ sender: "c", host: true, driver: "x" }, [peer("b")]).driver).toBe("c");
  });

  it("a leaving host's successor: the earliest co-host here, else whoever has been here longest", () => {
    const since = new Map([
      ["late", 20],
      ["early", 10],
    ]);
    expect(successor({ host: "h", cohosts: ["gone", "late"] }, ["early", "late"], since)).toBe("late");
    expect(successor({ host: "h", cohosts: [] }, ["late", "early"], since)).toBe("early");
    expect(successor({ host: "h", cohosts: [] }, [], since)).toBeUndefined();
  });

  it("the run to follow: the roster's driver's if they show one, else anyone's", () => {
    const live = { run: "r.1", title: "t", playing: true };
    const peers = [peer("a", { live }), peer("b", { live })];
    expect(driverOf({ cohosts: [], driver: "b" }, peers)?.sender).toBe("b");
    expect(driverOf({ cohosts: [], driver: "x" }, peers)?.sender).toBe("a");
    expect(driverOf({ cohosts: [] }, [peer("a")])).toBeUndefined();
  });
});
