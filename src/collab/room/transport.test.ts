import { describe, expect, it, onTestFinished, vi } from "vitest";
import { COLLAB_STUN, COLLAB_TRACKERS } from "../transport/tracker";
import { roomRelayUrl, roomTransport, serviceHosts } from "./transport";
import { deriveRoomKeys } from "../keys";
import { roomFor } from "../transport/conformance";
import { PrivateDiagramError } from "../session";

describe("what the consent dialogs say a room contacts", () => {
  it("checks privacy again after loading a transport and before opening any socket", async () => {
    const attempted = vi.fn();
    vi.stubGlobal("WebSocket", function ForbiddenSocket() {
      attempted();
      throw new Error("Socket forbidden in this test");
    });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const keys = await deriveRoomKeys(roomFor(0));
    let allowed = true;
    const opening = roomTransport(keys, () => allowed).then((transport) => {
      transport.close();
      return transport;
    });
    allowed = false;
    await expect(opening).rejects.toBeInstanceOf(PrivateDiagramError);
    expect(attempted).not.toHaveBeenCalled();
  });
  it("resolves the default relay under the served base, upgrading HTTPS to WSS", () => {
    expect(roomRelayUrl("https://diagrams.example/tools/diagrams/")).toBe(
      "wss://diagrams.example/tools/diagrams/collab/v1",
    );
    expect(roomRelayUrl("http://127.0.0.1:6501/")).toBe("ws://127.0.0.1:6501/collab/v1");
  });
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
