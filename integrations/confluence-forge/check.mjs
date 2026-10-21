import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import process from "node:process";
import { parse } from "yaml";

/** Deliberately small offline contract lint. This is not a claim that forge lint/deploy was run. */
export function checkManifest(source) {
  const manifest = parse(source);
  assert.deepEqual(Object.keys(manifest).sort(), ["app", "modules", "permissions", "resources"]);
  assert.deepEqual(manifest.modules, {
    macro: [
      {
        key: "live-diagram",
        title: "Live Diagram",
        description: "View and play a diagram stored on this page.",
        resource: "diagram-view",
        config: { resource: "diagram-config", title: "Live Diagram", viewportSize: "large", openOnInsert: true },
      },
    ],
  });
  assert.deepEqual(manifest.resources, [
    { key: "diagram-view", path: "dist/view" },
    { key: "diagram-config", path: "dist/config" },
  ]);
  assert.deepEqual(manifest.permissions, {
    scopes: ["read:attachment:confluence", "write:confluence-file"],
    content: { styles: ["unsafe-inline"] },
  });
  assert.deepEqual(Object.keys(manifest.app).sort(), ["id", "runtime"]);
  assert.match(manifest.app.id, /^ari:cloud:ecosystem::app\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  assert.deepEqual(manifest.app.runtime, { name: "nodejs24.x" });
}

// 885 kB measured including both resources, icons and fonts; about 15% headroom.
export const RESOURCE_GZIP_BUDGET = 1_020_000;
export const RESOURCE_RAW_BUDGET = 5_000_000;
export function checkBudget(files) {
  let raw = 0;
  let gzip = 0;
  for (const source of files.values()) {
    const bytes = typeof source === "string" ? Buffer.from(source) : source;
    raw += bytes.length;
    gzip += gzipSync(bytes, { level: 9 }).length;
  }
  assert.ok(raw <= RESOURCE_RAW_BUDGET, `Forge resources ${raw} raw bytes exceed ${RESOURCE_RAW_BUDGET}`);
  assert.ok(gzip <= RESOURCE_GZIP_BUDGET, `Forge resources ${gzip} gzip bytes exceed ${RESOURCE_GZIP_BUDGET}`);
  console.log(
    `Forge resource budget: ${raw} raw, ${gzip} gzip bytes (limits ${RESOURCE_RAW_BUDGET}, ${RESOURCE_GZIP_BUDGET}).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkManifest(readFileSync(new URL("manifest.yml", import.meta.url), "utf8"));
  console.log("Forge manifest: offline contract lint passed (no external permissions, no resolver).");
}
