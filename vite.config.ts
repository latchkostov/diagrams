import { staticPages } from "./scripts/static-pages";
import { publicExamplesOnly } from "./scripts/public-examples-only";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { exampleMetadataPlugin } from "./scripts/example-metadata";
import { skillAssetsPlugin } from "./scripts/skill-assets";
import { securityHeaders } from "./scripts/security-headers";
import { interactiveViewer } from "./scripts/interactive-viewer";
import { deploymentSwitches } from "./scripts/deployment-env";
import { selfHostPreviewHeaders } from "./scripts/self-host-headers";
import { i18n } from "./scripts/i18n-plugin";
import { schemaAssets } from "./scripts/schema-assets";

/**
 * `VITE_E2E=1` builds the app for the e2e suite: a production build that keeps the dev-only test hooks
 * (the `?storage=test` provider, the Lab tab). Every other build must leave them out.
 */
const E2E_BUILD = process.env.VITE_E2E === "1";

/**
 * The commit this build is from (Vercel's, else the checkout's), shown by the Lab's on-device evals so a
 * run says which code it measured (run 5 measured a stale production deploy without knowing it).
 */
const BUILD_SHA = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
})();

/** Fails a production build if anything from src/examples/private (local-only work diagrams) ships. */
export function noPrivateExamples(): Plugin {
  const isPrivate = (id: string) =>
    /[/\\]examples[/\\]private[/\\]/.test(id) || /[/\\]localOnly\.dev\.ts(?:\?|$)/.test(id);
  return {
    name: "no-private-examples",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const leaked = Object.entries(out.modules).filter(([id, m]) => isPrivate(id) && m.renderedLength > 0);
        if (leaked.length) this.error(`Local-only example or fingerprint data bundled into ${out.fileName}`);
      }
    },
  };
}

/** Fails a build that isn't the e2e build if a dev-only test hook ships (see E2E_BUILD). */
function noTestHooks(): Plugin {
  // The test storage provider, and the Lab (a development tool whose Load JSON stores pasted diagrams).
  const isHook = (id: string) =>
    /[/\\]interop[/\\]storage[/\\]testProvider\.ts$/.test(id) || /[/\\]src[/\\]lab[/\\]LabView\.tsx$/.test(id);
  return {
    name: "no-test-hooks",
    apply: "build",
    generateBundle(_options, bundle) {
      if (E2E_BUILD) return;
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const hooks = Object.entries(out.modules).filter(([id, m]) => isHook(id) && m.renderedLength > 0);
        // The camera's command journal (src/canvas/camera/journal.ts) and the interaction journal
        // (src/canvas/interaction/journal.ts) fold away outside e2e builds.
        if (
          hooks.length ||
          out.code.includes("Test storage") ||
          out.code.includes("__cameraJournal") ||
          out.code.includes("__interactionJournal")
        )
          this.error(`e2e-only test hooks bundled into ${out.fileName}; only VITE_E2E=1 builds may include them`);
      }
    },
  };
}

/**
 * The canvas's code in two chunks. Left alone, the bundler splits what CanvasView imports (beyond the entry)
 * into a dozen small chunks, shared with the live session, the Lab, the stencil library, the converters and
 * so on, and the canvas's first view queues for each of them. Instead: "CanvasView" holds what only code
 * that comes with the canvas uses (React Flow included); "canvas-shared" holds the rest, the few modules
 * that code able to load without a canvas (the stencil library, the command palette, the converters, ...)
 * also imports, so opening that code never downloads the canvas itself. The plugin reads the module graph
 * once it is known; the groups (build.rolldownOptions.output.codeSplitting) apply it.
 */
function canvasChunks() {
  const groups = new Map<string, string>();
  const plugin: Plugin = {
    name: "canvas-chunk",
    apply: "build",
    buildEnd() {
      groups.clear();
      const info = (id: string) => this.getModuleInfo(id);
      const ids = [...this.getModuleIds()];
      const reach = (from: Iterable<string>) => {
        const seen = new Set<string>();
        const stack = [...from];
        for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
          if (seen.has(id)) continue;
          seen.add(id);
          stack.push(...(info(id)?.importedIds ?? []));
        }
        return seen;
      };
      const canvas = ids.find((id) => /[/\\]src[/\\]canvas[/\\]CanvasView\.tsx$/.test(id));
      if (!canvas) return;
      const initial = reach(ids.filter((id) => info(id)?.isEntry));
      const own = [...reach([canvas])].filter((id) => !initial.has(id));
      // Code that only ever loads with the canvas: its own modules, what they alone import dynamically (the
      // live session, its dialogs, ...), and the Lab (a development tool made of canvases).
      const withCanvas = new Set(own);
      const lazy = ids.filter((id) => info(id)?.dynamicImporters.length);
      const lab = (id: string) => /[/\\]src[/\\]lab[/\\]LabView\.tsx$/.test(id);
      for (let grew = true; grew;) {
        grew = false;
        for (const id of lazy) {
          const onlyFromCanvas = info(id)?.dynamicImporters.every((by) => withCanvas.has(by));
          if (withCanvas.has(id) || !(lab(id) || onlyFromCanvas)) continue;
          for (const dep of reach([id])) if (!initial.has(dep)) withCanvas.add(dep);
          grew = true;
        }
      }
      const shared = reach(lazy.filter((id) => !withCanvas.has(id)));
      for (const id of own) groups.set(id, shared.has(id) ? "canvas-shared" : "CanvasView");
    },
  };
  return {
    plugin,
    // Only these modules: everything they import is in the entry, which always loads first, or in a group.
    group: { name: (id: string) => groups.get(id) ?? null, includeDependenciesRecursively: false },
  };
}
const canvas = canvasChunks();
// The Interactive HTML export's template: its own single-file build, emitted beside the app.
const viewer = interactiveViewer(() => [noPrivateExamples()]);

export default defineConfig({
  // Relative base so the build can be served from any sub-path (e.g. latchkostov.com/tools/diagrams/).
  base: "./",
  // Reports contain HTML snapshots. Watching them adds work and broadcasts reloads
  // during the same test run, even though none is application source.
  server: { watch: { ignored: ["**/tests/.output/**"] } },
  plugins: [
    ...(process.env.VITEST || process.env.E2E_GATE === "1" ? [publicExamplesOnly()] : []),
    // Messages inlined where they're used, each language a lazy catalog (src/i18n, docs/I18N.md).
    i18n(),
    staticPages(),
    exampleMetadataPlugin(),
    schemaAssets(),
    react(),
    noPrivateExamples(),
    noTestHooks(),
    // The agent skill's /skill/ folder and zip, with the current viewer template.
    skillAssetsPlugin(viewer.api.template),
    // CSP and the other security headers on `vite preview`, exactly as vercel.json sends them. Not in dev.
    securityHeaders(),
    canvas.plugin,
    viewer,
    // Self-hosting switches (src/lib/deployment.ts, docs/SELF-HOSTING.md), folded to constants; the brand name.
    deploymentSwitches(),
    // `vite preview` with a self-hosted copy's headers, for PREVIEW_HEADERS=self-host (the e2e suite).
    selfHostPreviewHeaders(),
  ],
  // Always defined, so `import.meta.env.VITE_E2E === "1"` folds to a constant and the hooks drop out.
  define: {
    "import.meta.env.VITE_E2E": JSON.stringify(E2E_BUILD ? "1" : ""),
    // A plain constant, not import.meta.env: env keys land in the entry chunk's env object.
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  build: {
    // Icons are many small SVGs; serving them as cached files keeps them out of the main JS chunk.
    assetsInlineLimit: 0,
    rolldownOptions: {
      // Every imported constant inlined where it's read (the default inlines only some reads): the self-hosting
      // switches (src/lib/deployment.ts) fold in every chunk, so the code they turn off drops out.
      optimization: { inlineConst: true },
      output: {
        // Keep upstream notices, including the MIT-licensed image-export port, in the shipped JavaScript.
        comments: { legal: true },
        codeSplitting: {
          groups: [
            canvas.group,
            // Keep the model-level admission validator in the existing preloaded native chunk.
            // Headless simulation imports the model directly; browsers need no extra startup request.
            {
              name: "native",
              test: /[/\\]src[/\\](?:interop[/\\]native|model[/\\](?:admissionSchema|admission|ids|relations|jsonSchema|simProps))\.ts$/,
              includeDependenciesRecursively: false,
            },
            // The headless core stays separate in source, but shares the browser's existing runtime request.
            {
              name: "i18n",
              test: /[/\\]src[/\\]i18n[/\\](?:core|index)\.ts$/,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  test: {
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // CI runners with coverage are several times slower. Timing tests compare sizes or count work instead of
    // budgets in ms (docs/QUALITY.md § Timing in tests), so only the timeout scales.
    testTimeout: process.env.CI ? 40_000 : 5_000,
    css: { include: [/tokens\.css/] },
    typecheck: {
      enabled: true,
      tsconfig: "tsconfig.node.json",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.*", "src/examples/**", "src/lab/**", "src/test/**"],
      reporter: ["text-summary", "html"],
    },
  },
});
