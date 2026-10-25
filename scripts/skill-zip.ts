import { constants, crc32, deflateRawSync } from "node:zlib";
import { deflateAsync } from "@gfx/zopfli";
import type { SkillFile } from "./skill-assets";

const { Z_FILTERED } = constants;

/**
 * A deterministic zip (fixed timestamps, sorted entries, DEFLATE), so the same skill always gives the
 * same bytes. Entries sit in a top-level `livediagrams/` folder, as Claude's skill upload expects.
 */
export async function zipSkill(files: SkillFile[], folder = "livediagrams"): Promise<Buffer> {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(`${folder}/${f.name}`, "utf8");
    let body = deflateRawSync(f.data, { level: 9 });
    // The viewer and icon catalog compress best with different hash-table sizes (and the icons' many similar SVG
    // paths with filtered matching). Keep the smallest lossless stream per entry; ties retain the default bytes.
    for (const options of [{ memLevel: 6 }, { memLevel: 7 }, { memLevel: 9 }, { memLevel: 7, strategy: Z_FILTERED }]) {
      const candidate = deflateRawSync(f.data, { level: 9, ...options });
      if (candidate.length < body.length) body = candidate;
    }
    // Zopfli searches for a smaller standard DEFLATE stream without changing the payload or requiring a new
    // unzip format. Let large viewer entries split into as many blocks as they need; retain five search iterations.
    const optimized = Buffer.from(await deflateAsync(f.data, { numiterations: 5, blocksplittingmax: 0 }));
    if (optimized.length < body.length) body = optimized;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
