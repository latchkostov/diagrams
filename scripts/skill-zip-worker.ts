import { Worker } from "node:worker_threads";
import path from "node:path";
import type { SkillFile } from "./skill-assets";

/** Dev downloads keep the deterministic production compressor off Vite's event loop. */
export function zipSkillInWorker(files: SkillFile[], signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(import.meta.dirname, "skill-zip-thread.mjs"), { workerData: files });
    const clean = () => {
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
    };
    const abort = () => {
      clean();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (bytes: Uint8Array) => {
      clean();
      resolve(Buffer.from(bytes));
    });
    worker.once("error", (error) => {
      clean();
      reject(error);
    });
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", abort);
      reject(new Error(`Skill ZIP worker exited before returning an archive (${code})`));
    });
  });
}
