import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { createAdmission } from "../src/admission";
import { readConfig } from "../src/config";

const request = (forwarded: string) =>
  ({
    headers: { origin: "https://relay.invalid", "x-forwarded-for": forwarded },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;

describe("trusted proxy admission", () => {
  it.each([
    [1, "198.51.100.66, 192.0.2.1"],
    [2, "198.51.100.66, 192.0.2.1, 192.0.2.2"],
  ])("uses hop %i from the trusted end despite an attacker prefix", (hops, chain) => {
    const admission = createAdmission(
      readConfig({
        LD_TRUST_PROXY: "1",
        LD_TRUST_PROXY_HOPS: String(hops),
        LD_ORIGIN: "https://relay.invalid",
        LD_SOCKETS_PER_IP: "1",
      }),
    );
    expect(admission.admit(request(chain))).toEqual({ ip: "192.0.2.1" });
    expect(admission.admit(request(chain.replace("198.51.100.66", "198.51.100.67")))).toMatchObject({
      reason: "ip-cap",
    });
  });
  it.each(["192.0.2.1", "garbage, 192.0.2.1"])("rejects missing or invalid trusted hops: %s", (chain) => {
    const admission = createAdmission(
      readConfig({ LD_TRUST_PROXY: "1", LD_TRUST_PROXY_HOPS: "2", LD_ORIGIN: "https://relay.invalid" }),
    );
    expect(admission.admit(request(chain))).toMatchObject({ reason: "ip-cap" });
  });
});
