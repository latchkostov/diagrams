import { createReadStream } from "node:fs";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);
export const COMPRESSION_LIMITS = {
  concurrency: 2,
  fileBytes: 8 * 1024 * 1024,
  cacheBytes: 32 * 1024 * 1024,
  entries: 256,
};

/** Per-handler LRU: bound both retained output and concurrent input/compression work. */
export class CompressionCache {
  private cached = new Map<string, Buffer>();
  private pending = new Map<string, Promise<Buffer>>();
  private bytes = 0;
  constructor(private readonly limits = COMPRESSION_LIMITS) {}

  get(
    file: string,
    version: string,
    size: number,
    encoding: "br" | "gzip",
    prepared?: Buffer,
  ): Promise<Buffer> | undefined {
    const key = `${file}\0${version}\0${encoding}`;
    const hit = this.cached.get(key);
    if (hit) {
      this.cached.delete(key);
      this.cached.set(key, hit);
      return Promise.resolve(hit);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (size > this.limits.fileBytes || this.pending.size >= this.limits.concurrency) return;
    const task = (async () => {
      try {
        const chunks: Buffer[] = [];
        if (!prepared)
          for await (const chunk of createReadStream(file, { end: this.limits.fileBytes }))
            chunks.push(chunk as Buffer);
        const source = prepared ?? Buffer.concat(chunks);
        // A file may grow after stat; never compress an oversized input.
        if (source.length > this.limits.fileBytes) throw new Error("Static asset changed size");
        const result = await (encoding === "br"
          ? brotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
          : gz(source));
        if (result.length > this.limits.cacheBytes) return result;
        while (
          this.cached.size &&
          (this.bytes + result.length > this.limits.cacheBytes || this.cached.size >= this.limits.entries)
        ) {
          const oldest = this.cached.entries().next().value;
          if (!oldest) break;
          this.bytes -= oldest[1].length;
          this.cached.delete(oldest[0]);
        }
        this.cached.set(key, result);
        this.bytes += result.length;
        return result;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, task);
    return task;
  }
}
