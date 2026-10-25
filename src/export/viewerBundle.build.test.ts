import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { catalog } from "../stencils/catalog";
import { buildViewerBundle } from "../../scripts/viewer-bundle";

describe("static platform viewer", () => {
  it("builds deterministic external assets and self-hosted fonts without workers or editing", async () => {
    const modules: string[] = [];
    const files = await buildViewerBundle(resolve("."), {
      plugins: [
        {
          name: "viewer-module-regression",
          generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle))
              if (chunk.type === "chunk")
                modules.push(
                  ...Object.entries(chunk.modules)
                    .filter(([, module]) => module.renderedLength > 0)
                    .map(([id]) => id.replaceAll("\\", "/")),
                );
          },
        },
      ],
    });
    expect(modules.some((id) => id.endsWith("/src/editor/builtinActions.ts"))).toBe(false);
    for (const path of [
      "/src/canvas/placement/useQuickAddPlacement.ts",
      "/src/canvas/ConnectedQuickAddMenu.tsx",
      "/src/canvas/LandingOutline.tsx",
      "/src/canvas/selection/useBoxSelection.ts",
      "/src/canvas/inspector/QueueFields.tsx",
      "/src/canvas/inspector/PriorityField.tsx",
      "/src/live/session/useLiveFixes.ts",
      "/src/live/TroubleCallout.tsx",
      "/src/live/threadFixes.ts",
      "/src/live/resilienceFixPlan.ts",
      "/src/planning/RoutingFields.tsx",
      "/src/planning/AutoscalingFields.tsx",
    ])
      expect(
        modules.some((id) => id.endsWith(path)),
        path,
      ).toBe(false);
    expect(modules.filter((id) => /\/src\/tutorials\/(?!sandbox\.ts$)/.test(id))).toEqual([]);
    for (const path of [
      "/src/sim/shedQueue.ts",
      "/src/live/session/useLiveDiagramChanges.ts",
      "/src/planning/NodePlanning.tsx",
      "/src/sim/autoscaling.ts",
      "/src/model/requestRouting.ts",
      "/src/styles/inspector-layout.css",
    ])
      expect(
        modules.some((id) => id.endsWith(path)),
        path,
      ).toBe(true);
    for (const name of ["router", "shaped"])
      expect(
        modules.some((id) => id.endsWith(`/src/canvas/geometry/${name}.ts`)),
        name,
      ).toBe(true);
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
    expect.soft(html).toContain("img-src 'self' data: blob:");
    expect.soft(html).toContain("media-src blob:");
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
    const icons = [...files.keys()].filter((name) => name.endsWith(".svg"));
    expect.soft(icons).toHaveLength(new Set(catalog.map((stencil) => stencil.icon)).size);
    expect(icons.every((name) => /^assets\/[\w.-]+-[\w-]+\.svg$/.test(name))).toBe(true);
    expect.soft(js.includes("data:image/svg+xml,")).toBe(false);
    expect(js).not.toMatch(/new Worker\(|indexedDB\.open|particleWorker/);
    // Fail closed if future imports pull the editor or a worker into this build (viewerSwaps checks modules).
    expect([...files.keys()].filter((f) => /worker.*\.js$/i.test(f))).toEqual([]);
  }, 120_000);
});
