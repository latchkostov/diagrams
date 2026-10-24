import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "vite";
import { expect, it } from "vitest";
import { readDeployment } from "../../scripts/deployment-env";
import { offlineBuildEnv } from "../../scripts/offline-package";
import { productionBuild } from "../test/productionBuild";

const settingsCases: Record<string, string>[] = [{ VITE_ENABLE_COLLAB: "1" }, { VITE_COLLAB: "server" }];
for (const source of ["shell", ".env.production"])
  for (const settings of settingsCases)
    it(`offline build excludes rooms with ${JSON.stringify(settings)} from ${source}`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "offline-env-"));
      try {
        const configured: Record<string, string> = {
          ...settings,
          VITE_COLLAB_SERVER: "wss://offline-relay.example/collab/v1",
          VITE_COLLAB_TRACKERS: "wss://offline-tracker.example/announce",
          VITE_COLLAB_STUN: "stun:offline-stun.example:3478",
        };
        writeFileSync(
          join(directory, ".env.production"),
          source === "shell"
            ? ""
            : Object.entries(configured)
                .map(([k, v]) => `${k}=${v}`)
                .join("\n"),
        );
        const files = loadEnv("production", directory, "VITE_");
        const env = { ...files, ...offlineBuildEnv(source === "shell" ? configured : {}, files) } as Record<
          string,
          string
        >;
        expect(readDeployment(env).collab).toBe(false);
        const output = await productionBuild(env);
        expect(
          output.chunks
            .flatMap((chunk) => Object.keys(chunk.modules))
            .filter((id) => /[/\\]src[/\\]collab[/\\]/.test(id)),
        ).toEqual([]);
        expect(output.chunks.filter((chunk) => /room/i.test(chunk.fileName))).toEqual([]);
        const code = output.chunks.map((chunk) => chunk.code).join("\n");
        const headers = String(output.assets.find((asset) => asset.fileName === "headers.json")?.source);
        for (const text of [code, headers])
          expect(text).not.toMatch(
            /offline-(?:relay|tracker|stun)\.example|tracker\.(?:openwebtorrent\.com|webtorrent\.dev)|stun\.cloudflare\.com|\/collab\/v1/,
          );
      } finally {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10 });
      }
    }, 120_000);
