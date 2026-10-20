import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const execFile = promisify(execFileCallback);

it("bundles a standalone runtime with a healthcheck CLI that never starts another listener or loads static files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ld-server-bundle-"));
  let status = 200;
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.writeHead(status).end();
  });
  server.listen(0, "::1");
  await once(server, "listening");
  try {
    const output = join(directory, "main.mjs");
    await execFile(process.execPath, ["build.mjs", "--outfile", output], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
    });
    const bundle = await readFile(output, "utf8");
    expect(bundle).not.toMatch(/node_modules\/(?:vite|yjs)\//);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    const options = {
      env: { ...process.env, LD_HOST: "::1", LD_PORT: String(address.port), LD_STATIC_DIR: join(directory, "absent") },
    };
    await execFile(process.execPath, [output, "--healthcheck"], options);
    expect(requests).toEqual(["/healthz"]);
    status = 503;
    await expect(execFile(process.execPath, [output, "--healthcheck"], options)).rejects.toMatchObject({ code: 1 });
    // Exercise the real entrypoint under a mocked 512 MiB cgroup. It must fail before
    // static loading/listening, and emit an actionable, whitelisted startup message.
    const memoryLimit = `data:text/javascript,${encodeURIComponent('import process from "node:process"; process.constrainedMemory = () => 512 * 1024 * 1024;')}`;
    await expect(
      execFile(process.execPath, ["--import", memoryLimit, output], {
        env: { ...options.env, LD_STATIC: "off", LD_TOTAL_BUFFER_BYTES: String(128 * 1024 * 1024 + 1) },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringMatching(
        /"event":"startup-error-buffer-budget".*LD_TOTAL_BUFFER_BYTES exceeds 25% of detected memory limit/,
      ),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
