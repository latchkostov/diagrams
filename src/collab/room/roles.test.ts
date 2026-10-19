import { describe, expect, it } from "vitest";
import type { PeerPresence } from "../presence";
import { driverOf, rolesOf, rosterOf, successor } from "./roles";

const peer = (sender: string, extra: Partial<PeerPresence> = {}): PeerPresence =>
  ({ sender, alias: sender, colour: 0, status: "active", seen: 0, member: `m-${sender}`, ...extra }) as PeerPresence;

describe("the room's roles (P3, cooperative)", () => {
  it("the host is whoever claims it (the lowest id of two); its roster names co-hosts and the driver by member", () => {
    const r = rosterOf({ sender: "b", member: "m-b" }, [
      peer("c", { host: true, cohosts: ["m-b", "m-gone"], driver: "m-b" }),
      peer("d", { host: true }),
    ]);
    expect(r).toMatchObject({ host: "c", cohosts: ["b"], driver: "b" });
    expect(rolesOf(r, "b")).toEqual({ host: false, cohost: true, driving: true });
    // The driver gone: the host drives.
    expect(rosterOf({ sender: "c", member: "m-c", host: true, driver: "m-x" }, [peer("b")]).driver).toBe("c");
  });

  it("with no host here, the last roster a host said stands: its co-hosts and driver, by member", () => {
    const r = rosterOf({ sender: "b", member: "m-b" }, [peer("d")], { host: "m-c", cohosts: ["m-b"], driver: "m-d" });
    expect(r).toMatchObject({ host: undefined, cohosts: ["b"], driver: "d" });
    // A member's new sender id (they reloaded): the same person.
    const again = rosterOf({ sender: "b2", member: "m-b" }, [], { cohosts: ["m-b"] });
    expect(again.cohosts).toEqual(["b2"]);
  });

  it("a leaving host's successor: the earliest co-host here, else whoever has been here longest", () => {
    const since = new Map([
      ["late", 20],
      ["early", 10],
    ]);
    const roster = (cohosts: string[]) => ({ host: "h", cohosts, source: { cohosts: [] } });
    expect(successor(roster(["gone", "late"]), ["early", "late"], since)).toBe("late");
    expect(successor(roster([]), ["late", "early"], since)).toBe("early");
    expect(successor(roster([]), [], since)).toBeUndefined();
  });

  it("the run to follow: the roster's driver's if they show one, else anyone's", () => {
    const live = { run: "r.1", title: "t", playing: true };
    const peers = [peer("a", { live }), peer("b", { live })];
    const roster = (driver?: string) => ({ cohosts: [], driver, source: { cohosts: [] } });
    expect(driverOf(roster("b"), peers)?.sender).toBe("b");
    expect(driverOf(roster("x"), peers)?.sender).toBe("a");
    expect(driverOf(roster(), [peer("a")])).toBeUndefined();
  });
});
