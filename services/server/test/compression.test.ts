import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompress, constants, brotliDecompressSync, gzip } from "node:zlib";
import { expect, it, onTestFinished, vi } from "vitest";
import { selfHostHeaderManifest } from "../../../scripts/self-host-headers";
import { CompressionCache, COMPRESSION_LIMITS } from "../src/compression";
import { startServer } from "./harness";

vi.mock("node:zlib", async (original) => {
  const zlib = await original<typeof import("node:zlib")>();
  return { ...zlib, brotliCompress: vi.fn(zlib.brotliCompress), gzip: vi.fn(zlib.gzip) };
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ld-compression-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "app.js");
  await writeFile(file, "export const app = true;".repeat(100));
  await writeFile(join(root, "index.html"), "<html><head></head></html>");
  await writeFile(join(root, "headers.json"), JSON.stringify(selfHostHeaderManifest({})));
  vi.mocked(brotliCompress).mockClear();
  vi.mocked(gzip).mockClear();
  return { root, file };
}

it("reuses compressed HTTP responses and explicitly sets Brotli quality 4", async () => {
  const f = await fixture();
  const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root });
  for (const name of ["br", "gzip"]) {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${s.origin}/app.js`, { headers: { "Accept-Encoding": name } });
      expect(res.headers.get("Content-Encoding")).toBe(name);
      expect(await res.text()).toBe("export const app = true;".repeat(100));
    }
  }
  expect(brotliCompress).toHaveBeenCalledOnce();
  expect(vi.mocked(brotliCompress).mock.calls[0][1]).toEqual({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  expect(gzip).toHaveBeenCalledOnce();
  await writeFile(f.file, "export const changed = true;");
  expect(await (await fetch(`${s.origin}/app.js`, { headers: { "Accept-Encoding": "br" } })).text()).toBe(
    "export const changed = true;",
  );
  expect(brotliCompress).toHaveBeenCalledTimes(2);
});

it("deduplicates in-flight work and bounds concurrent compression and input size", async () => {
  const { file } = await fixture();
  const cache = new CompressionCache();
  const first = cache.get(file, "1", 2300, "br");
  expect(cache.get(file, "1", 2300, "br")).toBe(first);
  const second = cache.get(file, "2", 2300, "gzip");
  expect(cache.get(file, "3", 2300, "br")).toBeUndefined();
  await Promise.all([first, second]);
  expect(brotliCompress).toHaveBeenCalledOnce();
  expect(gzip).toHaveBeenCalledOnce();
  expect(cache.get(file, "large", COMPRESSION_LIMITS.fileBytes + 1, "br")).toBeUndefined();
  expect(await cache.get(file, "3", 2300, "br")).toBeDefined();
});

it("falls back to identity under load, or 406 when identity is forbidden", async () => {
  const { root } = await fixture();
  const busy = vi.spyOn(CompressionCache.prototype, "get").mockReturnValue(undefined);
  onTestFinished(() => busy.mockRestore());
  const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: root });
  const res = await fetch(`${s.origin}/app.js`, { headers: { "Accept-Encoding": "br, gzip" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Encoding")).toBeNull();
  expect(await res.text()).toContain("export const app");
  const refused = await fetch(`${s.origin}/app.js`, { headers: { "Accept-Encoding": "br, identity;q=0" } });
  expect(refused.status).toBe(406);
  await refused.text();
});

it.each(["entries", "cacheBytes"] as const)("evicts cached variants at the %s bound", async (bound) => {
  const { file } = await fixture();
  const sample = await new CompressionCache().get(file, "sample", 2300, "br");
  if (!sample) throw new Error("Expected compressed sample");
  const cache = new CompressionCache({ ...COMPRESSION_LIMITS, [bound]: bound === "entries" ? 2 : sample.length * 2 });
  for (const version of ["1", "2", "1", "3"]) await cache.get(file, version, 2300, "br");
  vi.mocked(brotliCompress).mockClear();
  await cache.get(file, "1", 2300, "br");
  expect(brotliCompress).not.toHaveBeenCalled();
  const result = await cache.get(file, "2", 2300, "br");
  expect(brotliCompress).toHaveBeenCalledOnce();
  if (!result) throw new Error("Expected compressed result");
  expect(brotliDecompressSync(result).toString()).toBe("export const app = true;".repeat(100));
});
