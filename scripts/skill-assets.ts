// Serves the agent skill (skills/livediagrams/) from the site: every file under /skill/ (so
// /skill/SKILL.md and its relative links work) and the whole folder as /livediagrams-skill.zip, the
// upload format for Claude apps and a manual install for any agent. Emitted as separate assets, so the
// app bundle doesn't grow. In dev, the same paths are served from the folder.
//
// The HTML export's viewer template and icons (scripts/skill-viewer.ts) are committed only on release, for Claude
// Code's marketplace, which installs from git. The site serves them fresh from the current viewer instead, so the
// folder and the zip people download always match the app.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { RELEASED, releasedFiles } from "./skill-viewer";

export const SKILL_NAME = "livediagrams";
export const SKILL_ZIP = "livediagrams-skill.zip";
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SKILL_ROOT = path.join(REPO_ROOT, "skills", SKILL_NAME);

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

/** `files` with the released viewer files replaced by `fresh` ones (same names, same order). */
export function withFresh(files: SkillFile[], fresh: Readonly<Record<string, string>>): SkillFile[] {
  for (const name of Object.keys(fresh))
    if (!files.some((f) => f.name === name)) throw new Error(`skill-assets: the skill has no ${name} to refresh.`);
  return files.map((f) =>
    Object.hasOwn(fresh, f.name) ? { name: f.name, data: Buffer.from(fresh[f.name], "utf8") } : f,
  );
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

/**
 * `viewerTemplate`: the current Interactive HTML template (the interactive viewer plugin's), served in place of the
 * committed one along with fresh icons. Without it, the committed folder is served as it is.
 */
export function skillAssetsPlugin(viewerTemplate?: () => Promise<string>): Plugin {
  const current = async () => {
    const files = readSkill();
    return viewerTemplate ? withFresh(files, releasedFiles(REPO_ROOT, await viewerTemplate())) : files;
  };
  return {
    name: "skill-assets",
    async generateBundle() {
      const files = await current();
      for (const f of files) this.emitFile({ type: "asset", fileName: `skill/${f.name}`, source: f.data });
      this.emitFile({ type: "asset", fileName: SKILL_ZIP, source: zipSkill(files) });
    },
    configureServer(server) {
      // Cached between requests, and dropped on any change in the project (a skill file, an icon, or the viewer's
      // sources, which also rebuild its template). Ordinary skill files never wait for the viewer.
      let folder: SkillFile[] | undefined;
      let withViewer: Promise<{ files: SkillFile[]; zip: Buffer }> | undefined;
      server.watcher.on("all", () => {
        folder = undefined;
        withViewer = undefined;
      });
      const released = new Set<string>(Object.values(RELEASED).map((name) => `/skill/${name}`));
      const viewerFiles = () =>
        (withViewer ??= current().then(
          (files) => ({ files, zip: zipSkill(files) }),
          (error: unknown) => {
            withViewer = undefined;
            throw error;
          },
        ));
      const send = (res: ServerResponse, url: string, body: Buffer) => {
        res.setHeader("Content-Type", TYPES[path.extname(url)] ?? "text/plain; charset=utf-8");
        res.end(body);
      };
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
        if (url === `/${SKILL_ZIP}` || released.has(url))
          return void viewerFiles().then(({ files, zip }) => {
            const body = url === `/${SKILL_ZIP}` ? zip : files.find((f) => `/skill/${f.name}` === url)?.data;
            return body ? send(res, url, body) : next();
          }, next);
        if (!url.startsWith("/skill/")) return next();
        const body = (folder ??= readSkill()).find((f) => `/skill/${f.name}` === url)?.data;
        if (!body) return next();
        send(res, url, body);
      });
    },
  };
}
