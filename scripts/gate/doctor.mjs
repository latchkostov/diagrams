import os from "node:os";
import process from "node:process";
import console from "node:console";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { command, pnpm, pnpmCommand, required } from "./commands.mjs";
import { GIB, workerCount } from "./logic.mjs";

export const manifest = (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
export const imageName = (root) => {
  const version = JSON.parse(readFileSync(join(root, "node_modules/@playwright/test/package.json"), "utf8")).version;
  return `mcr.microsoft.com/playwright:v${version}-noble`;
};

export function installed(root) {
  try {
    const require = createRequire(join(root, "package.json"));
    const { parseAllDocuments } = require("yaml");
    const load = (path) => parseAllDocuments(readFileSync(path, "utf8")).map((doc) => doc.toJSON());
    // pnpm 12 stores the package-manager lock in a separate first YAML document.
    const expected = load(join(root, "pnpm-lock.yaml")).at(-1);
    const actual = load(join(root, "node_modules/.pnpm/lock.yaml")).at(-1);
    const pkg = manifest(root);
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (Object.keys(pkg[group] ?? {}).length !== Object.keys(expected.importers["."][group] ?? {}).length)
        return false;
      for (const [name, specifier] of Object.entries(pkg[group] ?? {})) {
        if (expected.importers["."][group]?.[name]?.specifier !== specifier) return false;
        if (!existsSync(join(root, "node_modules", name))) return false;
      }
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

export async function doctor(root, config) {
  let failures = 0;
  const item = (ok, label, fix) => {
    console.log(`${ok ? "OK" : "FAIL"}: ${label}${ok ? "" : `\n  Fix: ${fix}`}`);
    if (!ok) failures++;
  };
  const node = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
  item(
    process.versions.node === node || process.env.GATE_CONTAINER === "1",
    `Node ${process.versions.node} (pin ${node}${process.env.GATE_CONTAINER ? "; pinned image runtime" : ""})`,
    `Install fnm, then fnm install ${node} and fnm use ${node}.`,
  );
  const wanted = manifest(root).packageManager.split("@")[1];
  const version = await pnpm(["--version"], { cwd: root });
  const pnpmVersion = (version.stdout ?? version.text).trim();
  item(
    version.code === 0 && pnpmVersion === wanted,
    `pnpm ${pnpmVersion} (pin ${wanted})`,
    `Enable Corepack (corepack enable), then corepack prepare pnpm@${wanted} --activate.`,
  );
  item(
    installed(root),
    "node_modules matches the frozen lockfile and manifest",
    "pnpm gate setup (pnpm install --frozen-lockfile).",
  );
  let image;
  try {
    image = imageName(root);
    const require = createRequire(join(root, "package.json"));
    const { chromium } = require("@playwright/test");
    item(
      existsSync(chromium.executablePath()),
      "Pinned Chromium is installed",
      "pnpm gate setup (pnpm exec playwright install chromium).",
    );
  } catch {
    item(false, "Playwright dependency", "pnpm gate setup.");
  }
  if (config.docker && process.env.GATE_CONTAINER !== "1") {
    const docker = await command("docker", ["info", "--format", "{{.OSType}}"], { cwd: root });
    item(
      !docker.code,
      "Docker daemon is reachable",
      "Install/start Docker Desktop (Windows) or OrbStack/Docker Desktop (macOS); enable Linux containers.",
    );
    if (!docker.code && image) {
      const local = await command("docker", ["image", "inspect", image]);
      const remote = local.code ? await command("docker", ["manifest", "inspect", image]) : local;
      item(
        !remote.code,
        `${image} ${local.code ? "is pullable (setup pulls it)" : "is pulled"}`,
        `Check network access to mcr.microsoft.com, then docker pull ${image}.`,
      );
      if (config.linux) {
        const info = await command("docker", ["info", "--format", '{"cpus":{{.NCPU}},"memory":{{.MemTotal}}}']);
        if (!info.code) {
          const vm = JSON.parse(info.stdout);
          console.log(
            `Linux VM: ${vm.cpus} CPUs, ${(vm.memory / GIB).toFixed(1)} GiB RAM; workers=${config.workers ?? workerCount(vm.cpus, vm.memory)}`,
          );
        }
      }
    }
  } else console.warn("WARNING: Docker checks skipped; this run cannot produce a full verification stamp.");
  for (const [name, path] of [
    ["OS temp drive", os.tmpdir()],
    ["repo drive", root],
  ]) {
    try {
      const fs = statfsSync(path, { bigint: true });
      const free = Number(fs.bavail * fs.bsize) / GIB;
      item(
        free >= 8,
        `${name}: ${free.toFixed(1)} GiB free (${path})`,
        `Free at least 8 GiB on ${path}. Chrome needs writable temporary space.`,
      );
    } catch (error) {
      item(false, `${name}: ${error.message}`, `Check access to ${path}.`);
    }
  }
  console.log(
    `Machine: ${os.cpus()[0]?.model ?? os.arch()}, ${os.availableParallelism()} CPUs, ${(os.totalmem() / GIB).toFixed(1)} GiB RAM; workers=${config.workers ?? workerCount(os.availableParallelism(), os.totalmem())}`,
  );
  return failures === 0;
}

export async function setup(root, config) {
  if (!installed(root)) await required(...pnpmCommand(["install", "--frozen-lockfile"]), { cwd: root });
  await required(...pnpmCommand(["exec", "playwright", "install", "chromium"]), { cwd: root });
  if (config.docker) await required("docker", ["pull", imageName(root)], { cwd: root });
  return doctor(root, config);
}
