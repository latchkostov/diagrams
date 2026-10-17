import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import console from "node:console";

const children = new Set();
let cancelled = false;

/** Stop descendants too: the pnpm process owns Playwright's five app servers. */
export async function cancelCommands() {
  cancelled = true;
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          if (!child.pid || child.exitCode !== null) return resolve();
          if (process.platform === "win32") {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
              windowsHide: true,
            });
            killer.on("error", resolve);
            killer.on("close", resolve);
          } else {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              /* Already exited. */
            }
            resolve();
          }
        }),
    ),
  );
}

// Invoke the JS entry point, never a .cmd through a shell. Arguments (including paths
// with spaces) retain their identity in PowerShell, cmd, Git Bash and zsh.
export function pnpmCommand(args, entry = process.env.npm_execpath) {
  if (entry && /\.(?:c?js|mjs)$/.test(entry)) return [process.execPath, [entry, ...args]];
  // Standalone pnpm does not require Corepack to be installed on the host.
  if (entry && existsSync(entry) && !/\.(?:cmd|bat|ps1)$/i.test(entry)) return [entry, args];
  const corepack = join(dirname(process.execPath), "node_modules/corepack/dist/pnpm.js");
  if (existsSync(corepack)) return [process.execPath, [corepack, ...args]];
  // The Linux image has Corepack on PATH; this branch never invokes a shell.
  return ["corepack", ["pnpm", ...args]];
}

export function command(bin, args, { cwd, env = {}, log, live = false, input, signal, cleanup = false } = {}) {
  if (cancelled && !cleanup) return Promise.resolve({ code: 130, text: "Gate interrupted", stdout: "", stderr: "" });
  return new Promise((resolve) => {
    const output = log ? createWriteStream(log) : undefined;
    let text = "";
    let stdout = "";
    let stderr = "";
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, MSYS_NO_PATHCONV: "1", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true", ...env },
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      signal,
    });
    children.add(child);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    if (input) {
      input.pipe(child.stdin);
      child.stdin.on("error", () => {});
    }
    const collect = (chunk, stream) => {
      output?.write(chunk);
      if (live) process.stdout.write(chunk);
      text = (text + chunk).slice(-4_000_000);
      if (stream === "stdout") stdout = (stdout + chunk).slice(-4_000_000);
      else stderr = (stderr + chunk).slice(-4_000_000);
    };
    child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
    child.on("error", (error) => collect(String(error), "stderr"));
    child.on("close", (code) => {
      children.delete(child);
      output?.end();
      resolve({ code: code ?? 1, text, stdout, stderr });
    });
  });
}

export const pnpm = (args, config) => command(...pnpmCommand(args), config);

export async function git(args, cwd, execute = command) {
  const result = await execute("git", args, { cwd });
  if (result.code) throw new Error(`git ${args.join(" ")} failed: ${result.text}`);
  return result.stdout.trim();
}

export async function required(bin, args, config) {
  console.log(`$ ${bin} ${args.join(" ")}`);
  const result = await command(bin, args, { ...config, live: true });
  if (result.code) throw new Error(`Command failed (${result.code}): ${bin} ${args.join(" ")}`);
  return result;
}
