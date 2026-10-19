import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { preview } from "vite";
import { test as base } from "./fixtures";
import { expect } from "@playwright/test";
import { productionBuild } from "../../src/test/productionBuild";
import { createRelayServer } from "../../services/server/src/http";
import { readConfig } from "../../services/server/src/config";
import { createLog } from "../../services/server/src/log";
import { selfHostHeadersFor } from "../../scripts/self-host-headers";

export const test = base.extend<object, { relayBuild: string }>({
  relayBuild: [
    async ({ browserName }, use) => {
      const directory = await mkdtemp(join(tmpdir(), `ld-relay-${browserName}-`));
      try {
        const output = await productionBuild({ VITE_E2E: "1", VITE_COLLAB: "server", VITE_DISABLE_SHARE_LINKS: "1" });
        expect(
          output.chunks.some((chunk) =>
            Object.keys(chunk.modules).some((id) => /[/\\]transport[/\\]tracker\.ts$/.test(id)),
          ),
        ).toBe(false);
        expect(output.chunks.map((chunk) => chunk.code).join("\n")).not.toMatch(/RTCPeerConnection|stuns?:[a-z0-9]/);
        await cp("public", directory, { recursive: true });
        for (const file of [...output.chunks, ...output.assets]) {
          const destination = join(directory, file.fileName);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, file.type === "chunk" ? file.code : file.source);
        }
        await use(directory);
      } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 10 });
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});

/** Real relay behind the preview origin; no browser WebSocket routing or public infrastructure. */
export async function relayPreview(directory: string) {
  const relay = createRelayServer({
    config: readConfig({ LD_HOST: "127.0.0.1", LD_PORT: "0", LD_STATIC: "off" }),
    log: createLog(() => {}),
  });
  const target = await relay.listen();
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  try {
    const previewServer = await preview({
      configFile: false,
      logLevel: "silent",
      build: { outDir: directory },
      preview: {
        host: "127.0.0.1",
        port: 0,
        headers: selfHostHeadersFor("/"),
        proxy: { "/collab/": { target, ws: true } },
      },
    });
    server = previewServer;
    const address = previewServer.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Missing preview address");
    const origin = `http://127.0.0.1:${address.port}`;
    return {
      relay,
      origin,
      close: async () => {
        await relay.close();
        await new Promise<void>((resolve, reject) =>
          previewServer.httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      },
    };
  } catch (error) {
    await relay.close();
    const failedServer = server;
    if (failedServer) await new Promise<void>((resolve) => failedServer.httpServer.close(() => resolve()));
    throw error;
  }
}
