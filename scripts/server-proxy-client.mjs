// Bundled into a disposable container to exercise a distinct observed client IP.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import console from "node:console";
import { WebSocket } from "ws";

const [url, origin] = process.argv.slice(2);
const room = randomBytes(32).toString("base64url");
const open = () =>
  new WebSocket(url, "livediagrams.relay.v1", {
    origin,
    headers: { "X-Forwarded-For": "198.51.100.200" },
    handshakeTimeout: 30_000,
  });
// Keep both sockets alive while the second client proves it has its own quota.
for (let index = 0; index < 2; index++) {
  const socket = open();
  await once(socket, "open");
  const welcome = once(socket, "message");
  socket.send(JSON.stringify({ t: "hello", v: 1, room }));
  assert.equal(JSON.parse((await welcome)[0].toString()).t, "welcome");
  socket.on("close", () => {
    console.error("Quota holder unexpectedly disconnected");
    process.exit(1);
  });
}
const extra = open();
const status = await new Promise((resolve, reject) => {
  extra.once("unexpected-response", (_req, response) => {
    response.resume();
    resolve(response.statusCode);
    extra.terminate();
  });
  extra.once("open", () => reject(new Error("Client exceeded its own quota")));
  extra.once("error", reject);
});
assert.equal(status, 429);
console.log("PASS independent client quota");
