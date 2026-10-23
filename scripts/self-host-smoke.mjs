import { randomUUID } from "node:crypto";
import { runnerImport } from "vite";
import { spawnSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { URL } from "node:url";
import { expect } from "@playwright/test";

if (!process.argv.includes("--static-only")) await import("./server-smoke.mjs");
if (process.argv.includes("--server-only")) process.exit(0);

const fetch = globalThis.fetch;
const { withSmokeContainer, waitForStableEndpoint } = (
  await runnerImport(path.resolve("scripts/self-host-container.ts"), { configFile: false, logLevel: "error" })
).module;
const { withSmokeBrowser } = (
  await runnerImport(path.resolve("scripts/self-host-browser.ts"), { configFile: false, logLevel: "error" })
).module;
const invocation = randomUUID();

const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0)
    throw new Error(`${command} ${args[0]} failed: ${result.stderr ?? result.error ?? result.status}`);
  return result.stdout;
};
run("docker", [
  "run",
  "--rm",
  "-v",
  `${path.resolve("deploy/self-host/caddy/Caddyfile")}:/etc/caddy/Caddyfile:ro`,
  "caddy:2-alpine",
  "caddy",
  "validate",
  "--config",
  "/etc/caddy/Caddyfile",
  "--adapter",
  "caddyfile",
]);
for (const [base, tag] of [
  ["/", "root"],
  ["/tools/diagrams/", "subpath"],
]) {
  const image = `live-diagrams-smoke:${invocation}-${tag}`;
  run("docker", [
    "build",
    "--build-arg",
    `BASE_PATH=${base}`,
    "--build-arg",
    "FRAME_ANCESTORS=https://wiki.example.com",
    "--build-arg",
    "VITE_DISABLE_ONDEVICE=1",
    "--build-arg",
    "VITE_BRAND_NAME=Self-host smoke",
    "--build-arg",
    "VITE_LOCALES=en",
    "-t",
    image,
    ".",
  ]);
  await withSmokeContainer(run, image, async ({ id, origin }) => {
    await waitForStableEndpoint(`${origin}/healthz`);
    const user = run("docker", ["exec", id, "id", "-u"], true).trim();
    if (user === "0") throw new Error("Container runs as root");
    run("docker", ["exec", id, "nginx", "-t"]);
    const url = `${origin}${base}`;
    // Exercise curl as well as the full verifier, including the module's CORS response.
    const curl = process.platform === "win32" ? "curl.exe" : "curl";
    const headers = run(
      curl,
      ["--fail", "--silent", "--show-error", "-D", "-", "-o", process.platform === "win32" ? "NUL" : "/dev/null", url],
      true,
    );
    if (!/^Content-Security-Policy:/im.test(headers)) throw new Error("curl: missing CSP");
    if (!/^Cache-Control: no-cache/im.test(headers)) throw new Error("HTML must revalidate");
    const moduleHeaders = run(
      curl,
      [
        "--fail",
        "--silent",
        "--show-error",
        "-D",
        "-",
        "-o",
        process.platform === "win32" ? "NUL" : "/dev/null",
        new URL("embed/live-diagram.js", url).href,
      ],
      true,
    );
    if (
      !/^Access-Control-Allow-Origin: \*/im.test(moduleHeaders) ||
      !/^Cross-Origin-Resource-Policy: cross-origin/im.test(moduleHeaders)
    )
      throw new Error("curl: embed module missing CORS/CORP");
    const verify = spawnSync("pnpm", ["self-host:verify", url, "--frame-ancestors", "https://wiki.example.com"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (verify.status !== 0) throw new Error("Container headers failed verification");
    const html = await (await fetch(url)).text();
    const asset = html.match(/(?:src|href)="(\.\/assets\/[^"]+\.js)"/)?.[1];
    if (!asset) throw new Error("Missing startup asset");
    const hashed = await fetch(new URL(asset, url));
    if (!hashed.headers.get("Cache-Control")?.includes("immutable")) throw new Error("Hashed assets must be immutable");
    const compressed = run(
      curl,
      [
        "--fail",
        "--silent",
        "-H",
        "Accept-Encoding: gzip",
        "-D",
        "-",
        "-o",
        process.platform === "win32" ? "NUL" : "/dev/null",
        new URL(asset, url).href,
      ],
      true,
    );
    if (!/^Content-Encoding: gzip/im.test(compressed)) throw new Error("gzip is not active");
    for (const [path, status] of [
      ["a/deep/route", 200],
      ["assets/missing.js", 404],
      ["embed/missing.js", 404],
    ]) {
      const response = await fetch(new URL(path, url));
      if (response.status !== status) throw new Error(`${path}: expected ${status}, got ${response.status}`);
      if (status === 404 && response.headers.get("Cache-Control") !== "no-store")
        throw new Error(`${path}: errors must not be cached as immutable`);
      if (status === 200) {
        const fallback = await response.text();
        const prefix = fallback.match(/<base data-self-host="true" href="([^"]+)"/)?.[1];
        if (prefix !== base) throw new Error("Deep fallback lacks its asset base");
        if (!(await fetch(new URL(asset, new URL(prefix, response.url)))).ok)
          throw new Error("Deep fallback startup asset cannot load");
      }
    }
    if (base !== "/") {
      const redirect = await fetch(`${origin}${base.slice(0, -1)}?keep=1`, {
        redirect: "manual",
        headers: { Host: "diagrams.example.com", "X-Forwarded-Proto": "https" },
      });
      expect(redirect.status).toBe(308);
      expect(redirect.headers.get("location")).toBe(`${base}?keep=1`);
    }
    if (base !== "/" && (await fetch(`${origin}/`)).status !== 404)
      throw new Error("Sub-path image exposes root unexpectedly");
    await withSmokeBrowser(async (newContext) => {
      const context = await newContext();
      const page = await context.newPage();
      const errors = [];
      const outside = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        const address = new URL(request.url());
        if (["https:", "http:"].includes(address.protocol) && address.origin !== new URL(url).origin)
          outside.push(request.url());
      });
      const destination = new URL("a/deep/route?view=canvas&example=kafka-order-pipeline", url).href;
      await waitForStableEndpoint(destination);
      await page.goto(destination);
      await expect(page.getByTestId("canvas-wrap")).toBeVisible();
      await expect(page.getByTestId("brand")).toHaveText("Self-host smoke");
      await expect(page.getByTestId("ai-rail")).toHaveCount(0);
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-share").click();
      await expect(page.getByTestId("share-chooser")).toBeVisible();
      await expect(page.getByTestId("share-public-toggle")).toHaveCount(0);
      await expect(page.getByTestId("share-option-password")).toHaveCount(0);
      await page.getByTestId("share-option-embed").click();
      const snippet = await page.getByTestId("embed-snippet").inputValue();
      const scriptUrl = snippet.match(/<script type="module" src="([^"]+)"/)?.[1];
      expect(scriptUrl).toBe(new URL("embed/live-diagram.js", url).href);
      const module = await fetch(scriptUrl);
      expect(module.ok).toBe(true);
      expect(module.headers.get("Content-Type")).toMatch(/javascript/);
      expect(outside).toEqual([]);
      expect(errors).toEqual([]);
    });
    console.log(`PASS ${tag}: non-root, CSP/CORS, cache, gzip, fallback and path routing`);
  });
}
