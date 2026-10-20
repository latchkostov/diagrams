import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { compressedImageBytes } from "../../scripts/server-image-size";

// Docker save supports both classic uncompressed layers and compressed OCI blobs.
const tar = (entries: [string, Buffer][]) =>
  Buffer.concat(
    entries
      .flatMap(([name, contents]) => {
        const header = Buffer.alloc(512);
        header.write(name);
        header.write(contents.length.toString(8).padStart(11, "0"), 124);
        return [header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)];
      })
      .concat([Buffer.alloc(1024)]),
  );

it("measures every compressed layer once, including shared layers, rather than archive padding or raw bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ld-layer-size-"));
  try {
    const archive = join(directory, "image.tar");
    const raw = Buffer.alloc(100_000, "a");
    const compressed = gzipSync(Buffer.from("already compressed layer"));
    await writeFile(
      archive,
      tar([
        ["manifest.json", Buffer.from(JSON.stringify([{ Layers: ["layer.tar", "blob", "layer.tar"] }]))],
        ["layer.tar", raw],
        ["blob", compressed],
        ["config.json", Buffer.from("metadata is not a layer")],
      ]),
    );
    expect(await compressedImageBytes(archive)).toBe(gzipSync(raw).length + compressed.length);
    await writeFile(archive, tar([["manifest.json", Buffer.from('[{"Layers":["absent"]}]')]]));
    await expect(compressedImageBytes(archive)).rejects.toThrow("Missing Docker image layer");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
