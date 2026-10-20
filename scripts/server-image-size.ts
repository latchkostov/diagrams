import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createGzip } from "node:zlib";

/** Sum compressed layer sizes from Docker's save archive, rather than its uncompressed inspect Size. */
export async function compressedImageBytes(archive: string): Promise<number> {
  const file = await open(archive, "r");
  const entries = new Map<string, { start: number; size: number }>();
  try {
    let position = 0;
    const header = Buffer.alloc(512);
    while ((await file.read(header, 0, 512, position)).bytesRead === 512 && header[0]) {
      const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
      const size = Number.parseInt(header.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim(), 8);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid Docker archive entry");
      entries.set(name, { start: position + 512, size });
      position += 512 + Math.ceil(size / 512) * 512;
    }
    const manifest = entries.get("manifest.json");
    if (!manifest || manifest.size > 1024 * 1024) throw new Error("Missing Docker save manifest");
    const raw = Buffer.alloc(manifest.size);
    await file.read(raw, 0, raw.length, manifest.start);
    const images = JSON.parse(raw.toString()) as { Layers: string[] }[];
    if (images.length !== 1 || !images[0].Layers.length) throw new Error("Expected one image with layers");
    let total = 0;
    for (const name of new Set(images[0].Layers)) {
      const layer = entries.get(name);
      if (!layer || !layer.size) throw new Error("Missing Docker image layer");
      const magic = Buffer.alloc(2);
      await file.read(magic, 0, 2, layer.start);
      if (magic[0] === 0x1f && magic[1] === 0x8b) total += layer.size;
      else {
        const input = createReadStream(archive, { start: layer.start, end: layer.start + layer.size - 1 });
        const gzip = createGzip();
        input.on("error", (error) => gzip.destroy(error));
        input.pipe(gzip);
        for await (const chunk of gzip) total += (chunk as Buffer).length;
      }
    }
    return total;
  } finally {
    await file.close();
  }
}
