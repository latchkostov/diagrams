// Serves the agent skill (skills/livediagrams/) from the site: every file under /skill/ (so
// /skill/SKILL.md and its relative links work) and the whole folder as /livediagrams-skill.zip, the
// upload format for Claude apps and a manual install for any agent. Emitted as separate assets, so the
// app bundle doesn't grow. In dev, the same paths are served from the folder.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import type { Plugin } from "vite";

export const SKILL_NAME = "livediagrams";
export const SKILL_ZIP = "livediagrams-skill.zip";
const SKILL_ROOT = path.resolve(import.meta.dirname, "..", "skills", SKILL_NAME);

export interface SkillFile {
  /** Path inside the skill folder, with forward slashes. */
  name: string;
  data: Buffer;
}

/** Every file in the skill folder, sorted (dotfiles skipped). */
export function readSkill(dir = SKILL_ROOT): SkillFile[] {
  const out: SkillFile[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const name = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(name);
      else if (e.isFile()) out.push({ name, data: readFileSync(path.join(dir, name)) });
    }
  };
  walk("");
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * A deterministic zip (fixed timestamps, sorted entries, DEFLATE), so the same skill always gives the
 * same bytes. Entries sit in a top-level `livediagrams/` folder, as Claude's skill upload expects.
 */
export function zipSkill(files: SkillFile[], folder = SKILL_NAME): Buffer {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(`${folder}/${f.name}`, "utf8");
    const body = deflateRawSync(f.data, { level: 9 });
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

const TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
};

export function skillAssetsPlugin(): Plugin {
  return {
    name: "skill-assets",
    generateBundle() {
      const files = readSkill();
      for (const f of files) this.emitFile({ type: "asset", fileName: `skill/${f.name}`, source: f.data });
      this.emitFile({ type: "asset", fileName: SKILL_ZIP, source: zipSkill(files) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split(/[?#]/)[0]);
        // The install page (public/skill/index.html) at /skill/, as static hosts and `vite preview` serve it.
        if (url === "/skill") {
          res.writeHead(302, { Location: "/skill/" });
          return res.end();
        }
        if (url === "/skill/") {
          req.url = "/skill/index.html";
          return next();
        }
        const files = url === `/${SKILL_ZIP}` || url.startsWith("/skill/") ? readSkill() : [];
        const body = url === `/${SKILL_ZIP}` ? zipSkill(files) : files.find((f) => `/skill/${f.name}` === url)?.data;
        if (!body) return next();
        res.setHeader("Content-Type", TYPES[path.extname(url)] ?? "text/plain; charset=utf-8");
        res.end(body);
      });
    },
  };
}
