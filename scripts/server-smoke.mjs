import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { runnerImport } from "vite";
import { chromium, expect } from "@playwright/test";
import { deploymentVariants } from "./server-deployment-smoke.mjs";

// First paint through a cold server on a loaded CI runner can exceed Playwright's 5 s default; only the
// app-boot waits get this allowance, and every assertion is unchanged.
const BOOT_TIMEOUT = 30_000;

const load = async (name) => (await runnerImport(path.resolve(name), { configFile: false, logLevel: "error" })).module;
const { withSmokeContainer, waitForStableEndpoint } = await load("scripts/self-host-container.ts");
const { compressedImageBytes } = await load("scripts/server-image-size.ts");
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0)
    throw new Error(`${command} ${args[0]} failed: ${result.stderr ?? result.error ?? result.status}`);
  return result.stdout;
};
const image = `live-diagrams-server-smoke:${randomUUID()}`;
const scratch = await mkdtemp(path.join(tmpdir(), "ld-server-image-"));
let built = false;
try {
  run("docker", ["compose", "-f", "deploy/self-host/server/compose.yaml", "config", "--quiet"]);
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${path.resolve("deploy/self-host/caddy/Caddyfile.server")}:/etc/caddy/Caddyfile:ro`,
    "caddy:2-alpine",
    "caddy",
    "validate",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ]);
  run("docker", [
    "run",
    "--rm",
    "--add-host",
    "diagrams:127.0.0.1",
    "-v",
    `${path.resolve("deploy/self-host/nginx/nginx.server.conf")}:/etc/nginx/conf.d/default.conf:ro`,
    "nginxinc/nginx-unprivileged:stable-alpine",
    "nginx",
    "-t",
  ]);
  run("docker", [
    "build",
    "-f",
    "services/server/Dockerfile",
    "--build-arg",
    "FRAME_ANCESTORS=https://wiki.example.com",
    "-t",
    image,
    ".",
  ]);
  built = true;
  const archive = path.join(scratch, "image.tar");
  run("docker", ["image", "save", "--output", archive, image]);
  const bytes = await compressedImageBytes(archive);
  console.log(`Server image: ${(bytes / 1_000_000).toFixed(2)} MB compressed layers (${bytes} bytes; limit 80 MB)`);
  if (bytes > 80_000_000) throw new Error("Server image exceeds 80 MB compressed");
  const config = JSON.parse(run("docker", ["image", "inspect", "--format", "{{json .Config}}", image], true));
  expect(config.User).toBe("nonroot:nonroot");
  expect(config.Volumes ?? {}).toEqual({});
  await deploymentVariants({
    run,
    image,
    scratch,
    ...(await load("scripts/self-host-templates.ts")),
    waitForStableEndpoint,
    protocol: await load("src/collab/transport/relayProtocol.ts"),
  });
  for (const base of ["/", "/tools/diagrams/"]) {
    await withSmokeContainer(
      run,
      image,
      async ({ id, origin }) => {
        await waitForStableEndpoint(`${origin}/healthz`);
        run("docker", ["exec", id, "/nodejs/bin/node", "main.js", "--healthcheck"]);
        const verify = spawnSync(
          process.execPath,
          ["scripts/verify-instance.mjs", `${origin}${base}`, "--frame-ancestors", "https://wiki.example.com"],
          { stdio: "inherit" },
        );
        if (verify.status !== 0) throw new Error("Server headers failed verification");
        const browser = await chromium.launch();
        const canary = `synthetic-diagram-canary-${randomUUID()}`;
        const rooms = new Set();
        try {
          const hostContext = await browser.newContext();
          const guestContext = await browser.newContext();
          const errors = [];
          const outside = [];
          for (const context of [hostContext, guestContext]) {
            await context.addInitScript(() => {
              globalThis.RTCPeerConnection = function () {
                throw new Error("Unexpected WebRTC");
              };
              globalThis.document.addEventListener("securitypolicyviolation", (event) => {
                throw new Error(`CSP: ${event.violatedDirective}`);
              });
            });
            context.on("page", (page) => {
              page.on("pageerror", (error) => errors.push(error.message));
              page.on("request", (request) => {
                if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin)
                  outside.push(request.url());
              });
              // Capture every actual lobby/content room ID without depending on invitation key schedules.
              page.on("websocket", (socket) =>
                socket.on("framesent", ({ payload }) => {
                  if (typeof payload !== "string") return;
                  const frame = JSON.parse(payload);
                  if (frame.t === "hello") rooms.add(frame.room);
                }),
              );
            });
          }
          const host = await hostContext.newPage();
          await host.goto(`${origin}${base}a/deep/route?view=canvas&example=kafka-order-pipeline`);
          await expect(host.getByTestId("node-gateway")).toBeVisible({ timeout: BOOT_TIMEOUT });
          await host.getByTestId("file-button").click();
          await host.getByTestId("file-share").click();
          await host.getByTestId("share-option-edit-together").click();
          await host.getByTestId("room-start-confirm").click();
          const link = await host.getByTestId("room-link").inputValue();
          await host.getByTestId("room-started-done").click();
          const guest = await guestContext.newPage();
          await guest.goto(link);
          await guest.getByTestId("room-join-accept").click();
          await host.getByTestId("room-knock-admit").first().click();
          await expect(guest.getByTestId("node-gateway")).toBeVisible({ timeout: BOOT_TIMEOUT });
          for (const [editor, follower, label] of [
            [host, guest, canary],
            [guest, host, `${canary}-return`],
          ]) {
            // Editing through the inspector avoids coordinate/camera assumptions under container load.
            await editor.getByTestId("node-gateway").click();
            const field = editor.getByTestId("inspector-field-label");
            await expect(field).toBeVisible();
            await field.fill(label);
            await field.press("Enter");
            await expect(follower.getByTestId("node-gateway")).toContainText(label);
          }
          expect(rooms.size).toBeGreaterThan(0);
          expect(errors).toEqual([]);
          expect(outside).toEqual([]);
        } finally {
          await browser.close();
        }
        const logs = run("docker", ["logs", id], true);
        expect(logs).toContain('"event":"listening"');
        expect(logs).not.toContain(canary);
        for (const room of rooms) expect(logs).not.toContain(room);
        console.log(`PASS server ${base}: read-only non-root, healthcheck, headers, two-way edits, private logs`);
      },
      { server: true, env: { LD_BASE: base } },
    );
  }
  await withSmokeContainer(
    run,
    image,
    async ({ id, origin }) => {
      await waitForStableEndpoint(`${origin}/healthz`);
      expect((await globalThis.fetch(origin)).status).toBe(404);
      run("docker", ["exec", id, "/nodejs/bin/node", "main.js", "--healthcheck"]);
      console.log("PASS relay-only: healthy with no static site or writable paths");
    },
    { server: true, env: { LD_STATIC: "off" } },
  );
} finally {
  try {
    if (built) run("docker", ["image", "rm", image]);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 10 });
  }
}
