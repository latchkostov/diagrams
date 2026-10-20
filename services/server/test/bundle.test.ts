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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
