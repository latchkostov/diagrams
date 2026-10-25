import { mkdtempSync, rmSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Worker } from "node:worker_threads";
import { createServer } from "vite";
import { expect, it, vi } from "vitest";
import { skillAssetsPlugin, SKILL_ZIP } from "../../scripts/skill-assets";

const workers = vi.hoisted(() => [] as Worker[]);
vi.mock("node:worker_threads", async (original) => {
  const real = await original<typeof import("node:worker_threads")>();
  return {
    ...real,
    Worker: class extends real.Worker {
      constructor(file: string | URL, options: import("node:worker_threads").WorkerOptions = {}) {
        // Hold the real compression thread before compression, independent of payload size or CPU speed.
        const preload = `import { workerData } from 'node:worker_threads';
          Atomics.wait(workerData.shutdownBarrier, 0, 0);`;
        super(file, {
          ...options,
          workerData: Object.assign(options.workerData, { shutdownBarrier: new Int32Array(new SharedArrayBuffer(4)) }),
          execArgv: ["--import", `data:text/javascript,${encodeURIComponent(preload)}`],
        });
        workers.push(this);
      }
    },
  };
});

it("closing the dev server terminates an in-flight ZIP worker and releases its handle", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "skill-shutdown-"));
  const server = await createServer({
    configFile: false,
    root,
    plugins: [skillAssetsPlugin()],
    server: { host: "127.0.0.1", port: 0, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  let request: ReturnType<typeof get> | undefined;
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    const portsBefore = process.getActiveResourcesInfo().filter((type) => type === "MessagePort").length;
    request = get(`http://127.0.0.1:${address.port}/${SKILL_ZIP}`);
    request.on("error", () => {}); // Closing Vite deliberately disconnects the unfinished download.
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];
    expect(worker.threadId).toBeGreaterThan(0);
    const exited = vi.fn();
    worker.once("exit", exited);
    await server.close();
    await vi.waitFor(() => expect(exited).toHaveBeenCalledOnce());
    expect(worker.threadId).toBe(-1);
    expect(process.getActiveResourcesInfo().filter((type) => type === "MessagePort")).toHaveLength(portsBefore);
    expect(server.httpServer!.listening).toBe(false);
  } finally {
    request?.destroy();
    await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
