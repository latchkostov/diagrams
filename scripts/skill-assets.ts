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
import { zipSkill } from "./skill-zip";
import { zipSkillInWorker } from "./skill-zip-worker";
export { zipSkill } from "./skill-zip";
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

/** Download only the skill payload, sorted; plugin listing files stay in the git installation. */
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
  out.push({ name: "SKILL.md", data: readFileSync(path.join(dir, "SKILL.md")) });
  walk("reference");
  walk("scripts");
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
      this.emitFile({ type: "asset", fileName: SKILL_ZIP, source: await zipSkill(files) });
    },
    configureServer(server) {
      // Cached between requests, and dropped on any change in the project (a skill file, an icon, or the viewer's
      // sources, which also rebuild its template). Ordinary skill files never wait for the viewer.
      const compression = new AbortController();
      server.httpServer?.once("close", () => compression.abort());
      let folder: SkillFile[] | undefined;
      let withViewer: Promise<SkillFile[]> | undefined;
      let zip: Promise<Buffer> | undefined;
      server.watcher.on("all", () => {
        folder = undefined;
        withViewer = undefined;
        zip = undefined;
      });
      const released = new Set<string>(Object.values(RELEASED).map((name) => `/skill/${name}`));
      const viewerFiles = () => {
        if (!withViewer) {
          const pending = current();
          withViewer = pending;
          void pending.catch(() => {
            if (withViewer === pending) withViewer = undefined;
          });
        }
        return withViewer;
      };
      // Only an explicit ZIP download pays for compression; viewer/file requests share just the fresh files.
      const skillZip = () => {
        if (!zip) {
          const pending = viewerFiles().then((files) => zipSkillInWorker(files, compression.signal));
          zip = pending;
          void pending.catch(() => {
            if (zip === pending) zip = undefined;
          });
        }
        return zip;
      };
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
        if (url === `/${SKILL_ZIP}`) return void skillZip().then((body) => send(res, url, body), next);
        if (released.has(url))
          return void viewerFiles().then((files) => {
            const body = files.find((f) => `/skill/${f.name}` === url)?.data;
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
