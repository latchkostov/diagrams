import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildViewerBundle } from "../../scripts/viewer-bundle";

describe("static platform viewer", () => {
  it("builds deterministic external assets and self-hosted fonts without workers or editing", async () => {
    const files = await buildViewerBundle(resolve("."));
    vi.stubEnv("VITE_BRAND_NAME", "UNEXPECTED_VIEWER_BRAND");
    vi.stubEnv("VITE_E2E", "1");
    vi.stubEnv("VITE_COLLAB", "1");
    try {
      const again = await buildViewerBundle(resolve("."));
      expect(again).toEqual(files);
    } finally {
      vi.unstubAllEnvs();
    }
    const html = String(files.get("index.html"));
    expect(html).toMatch(/<script type="module" src="\.\/assets\/viewer-[\w-]+\.js"><\/script>/);
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>|<style>/);
    expect(html).toContain("font-src 'self'");
    expect(html).toContain("worker-src 'none'");
    expect(html).not.toContain("unsafe-eval");
    expect([...files.keys()].filter((f) => f.endsWith(".woff2"))).toHaveLength(2);
    const css = [...files]
      .filter(([name]) => name.endsWith(".css"))
      .map(([, source]) => String(source))
      .join("");
    expect(css).not.toMatch(/data:font/);
    expect(css).toMatch(/url\([^)]*\.woff2\)/);
    const js = [...files]
      .filter(([name]) => name.endsWith(".js"))
      .map(([, source]) => String(source))
      .join("");
    expect(js).not.toMatch(/new Worker\(|indexedDB\.open|particleWorker/);
    // Fail closed if future imports pull the editor or a worker into this build (viewerSwaps checks modules).
    expect([...files.keys()].filter((f) => /worker/i.test(f))).toEqual([]);
  }, 120_000);
});
