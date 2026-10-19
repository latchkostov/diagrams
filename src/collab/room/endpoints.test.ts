import { describe, expect, it } from "vitest";
import { COLLAB_STUN, COLLAB_TRACKERS } from "../transport/tracker";
import { serviceHosts } from "./endpoints";

describe("what the consent dialogs say a room contacts", () => {
  it("the approved set by host: the two trackers and Cloudflare STUN", () => {
    expect(serviceHosts({ trackers: COLLAB_TRACKERS, iceServers: COLLAB_STUN })).toEqual([
      "tracker.openwebtorrent.com",
      "tracker.webtorrent.dev",
      "stun.cloudflare.com",
    ]);
  });

  it("a copy's own trackers, STUN and TURN, each host once", () => {
    expect(
      serviceHosts({
        trackers: ["wss://tracker.intranet.example/announce", "wss://tracker.intranet.example:8443"],
        iceServers: [
          { urls: "stun:stun.intranet.example:3478" },
          { urls: ["turn:turn.intranet.example:3478?transport=udp", "turns:turn.intranet.example:5349"] },
        ],
      }),
    ).toEqual(["tracker.intranet.example", "stun.intranet.example", "turn.intranet.example"]);
  });
});
