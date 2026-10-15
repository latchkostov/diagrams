import { spawnSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";

const fetch = globalThis.fetch;

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
for (const [base, port, tag] of [
  ["/", 6225, "root"],
  ["/tools/diagrams/", 6226, "subpath"],
]) {
  const image = `live-diagrams-smoke:${tag}`;
  const name = `live-diagrams-smoke-${tag}`;
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
  try {
    run("docker", [
      "run",
      "-d",
      "--name",
      name,
      "--read-only",
      "--tmpfs",
      "/tmp:uid=101,gid=101",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      `127.0.0.1:${port}:8080`,
      image,
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok;
      } catch {
        /* startup */
      }
      if (ready) break;
      await setTimeout(500);
    }
    if (!ready) throw new Error("Container did not become ready");
    const user = run("docker", ["exec", name, "id", "-u"], true).trim();
    if (user === "0") throw new Error("Container runs as root");
    run("docker", ["exec", name, "nginx", "-t"]);
    const url = `http://127.0.0.1:${port}${base}`;
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
    if (base !== "/" && (await fetch(`http://127.0.0.1:${port}/`)).status !== 404)
      throw new Error("Sub-path image exposes root unexpectedly");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      const outside = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        const address = new URL(request.url());
        if (["https:", "http:"].includes(address.protocol) && address.origin !== new URL(url).origin)
          outside.push(request.url());
      });
      await page.goto(new URL("a/deep/route?view=canvas&example=kafka-order-pipeline", url).href);
      await expect(page.getByTestId("canvas-wrap")).toBeVisible();
      await expect(page.getByTestId("brand")).toHaveText("Self-host smoke");
      await expect(page.getByTestId("ai-rail")).toHaveCount(0);
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-share").click();
      await expect(page.getByTestId("share-chooser")).toBeVisible();
      await expect(page.getByTestId("share-public-toggle")).toHaveCount(0);
      await expect(page.getByTestId("share-option-password")).toHaveCount(0);
      expect(outside).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
    console.log(`PASS ${tag}: non-root, CSP/CORS, cache, gzip, fallback and path routing`);
  } finally {
    run("docker", ["rm", "-f", name]);
  }
}
