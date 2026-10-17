import { expect, it } from "vitest";
import { isViteHmrHandshake } from "../../scripts/e2e-network";

it("recognizes only the dev server's exact HMR handshake", () => {
  const app = "http://localhost:6480/";
  const socket = "ws://localhost:6480/?token=test";
  expect(isViteHmrHandshake(socket, app, '{"type":"connected"}', "dev")).toBe(true);
  for (const [url, payload, target] of [
    [socket, '{"type":"connected"}', "build"],
    [socket, '{"kind":"hello"}', "dev"],
    [socket, "not json", "dev"],
    ["ws://elsewhere:6480/?token=test", '{"type":"connected"}', "dev"],
    ["ws://localhost:6481/?token=test", '{"type":"connected"}', "dev"],
    ["ws://localhost:6480/room?token=test", '{"type":"connected"}', "dev"],
    ["ws://localhost:6480/", '{"type":"connected"}', "dev"],
  ])
    expect(isViteHmrHandshake(url, app, payload, target)).toBe(false);
});
