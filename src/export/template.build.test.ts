import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildViewer, buildViewerTemplate, EDITOR_ONLY } from "../../scripts/interactive-viewer";
import { exportHtml, PAYLOAD_BLOCK, templateStencilIcons } from "./inject";
import { catalog } from "../stencils/catalog";
import * as translatedStencil from "../i18n/stencils";
import * as viewerStencil from "./viewer/stencilText";

// The Interactive HTML template, built for real (scripts/interactive-viewer.ts): one page whose CSP allows
// exactly its own inline script and style, that references nothing outside itself, and that comes out the same
// every time (a copy kept elsewhere, like the agent skill's, can be checked against a fresh build).

let template: string;
let modules: string[];

beforeAll(async () => {
  ({ html: template, modules } = await buildViewer(resolve(".")));
}, 120_000);

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
const csp = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? "";
/** The contents of every <tag> element without attributes (the executable script, the style). */
const blocks = (html: string, tag: "script" | "style") =>
  [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);

const ICONS = resolve("src/stencils/icons");
const allIcons = () =>
  Object.fromEntries(
    readdirSync(ICONS)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => [f.slice(0, -4), readFileSync(join(ICONS, f), "utf8")]),
  );

describe("interactive viewer template", () => {
  it("allows its one inline script and one inline style by hash, and nothing else", () => {
    const scripts = blocks(template, "script");
    const styles = blocks(template, "style");
    expect(scripts).toHaveLength(1);
    expect(styles).toHaveLength(1);
    const policy = csp(template);
    expect(policy).toContain(`script-src 'sha256-${sha256(scripts[0])}'`);
    expect(policy).toContain(`style-src 'sha256-${sha256(styles[0])}'`);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toMatch(/unsafe-|worker-src|'self'|https?:/);
    // The policy comes first, before anything it governs.
    expect(template.indexOf("Content-Security-Policy")).toBeLessThan(template.indexOf("<style>"));
  });

  it("loads nothing from outside: no src, no stylesheet links, no url() but data:", () => {
    expect(template).not.toMatch(/<script[^>]+\bsrc=/);
    expect(template).not.toMatch(/<link\b(?![^>]*href="data:)/);
    const urls = [...template.matchAll(/url\(\s*["']?([^"')\s]{0,40})/g)].map((m) => m[1]);
    // data: (the fonts) and same-document references (SVG markers, "url(#id)") only.
    expect(urls.filter((u) => !/^(data:|#|$)/.test(u))).toEqual([]);
    // No worker, no icon files, no bundled assets.
    expect(template).not.toMatch(/particleWorker|assets\/[\w.-]+\.(svg|js|css|woff2)/);
  });

  it("leaves the editing-only panels out (stubs in their place)", () => {
    const real = (path: string) => modules.some((id) => id.endsWith(path));
    expect(EDITOR_ONLY.filter((p) => real(p.path)).map((p) => p.name)).toEqual([]);
    expect(real("/src/canvas/edges/EdgeRouteHandles.tsx")).toBe(false);
    expect(real("/src/canvas/edges/segments.ts")).toBe(false);
    expect(real("/src/editor/routeCarry.ts")).toBe(false);
    expect(real("/src/canvas/interaction/routeGesture.ts")).toBe(false);
    expect(real("/src/canvas/placement/useDragPlacement.ts")).toBe(false);
    expect(real("/src/canvas/placement/readOnlyDragPlacement.ts")).toBe(true);
    expect(real("/src/canvas/placement/changeForwarding.ts")).toBe(true);
    expect(real("/src/canvas/interaction/usePointerGesture.ts")).toBe(false);
    expect(real("/src/live/LoadingSimPanel.tsx")).toBe(false);
    expect(real("/src/planning/LiveDetails.tsx")).toBe(false);
    expect(real("/src/planning/EdgeLiveDetails.tsx")).toBe(false);
    expect(real("/src/live/DockedLive.tsx")).toBe(false);
    expect(real("/src/i18n/stencils.ts")).toBe(false);
    // The icon map the viewer swaps in is one module, wherever the build runs (a Windows path once made two).
    expect(modules.filter((id) => id.endsWith("/src/export/viewer/iconUrls.ts"))).toHaveLength(1);
    // A protected file decrypts with the token's crypto, never the link adapter around it.
    expect(real("/src/interop/passwordCrypto.ts")).toBe(true);
    expect(real("/src/interop/encryptedToken.ts")).toBe(true);
    expect(modules.filter((id) => /\/src\/interop\/(share|shareCrypto|passwordLink)\.ts$/.test(id))).toEqual([]);
    // The canvas and the live session themselves are there.
    expect(real("/src/canvas/CanvasView.tsx")).toBe(true);
    expect(real("/src/live/LiveSession.tsx")).toBe(true);
  });

  it("renders saved routes without the editing action catalog", () => {
    expect(modules.some((id) => id.endsWith("/src/editor/builtinActions.ts"))).toBe(false);
    for (const name of ["router", "shaped"])
      expect(
        modules.some((id) => id.endsWith(`/src/canvas/geometry/${name}.ts`)),
        name,
      ).toBe(true);
  });

  it("omits quick-add and box-selection authoring from the read-only canvas", () => {
    for (const path of [
      "/src/canvas/placement/useQuickAddPlacement.ts",
      "/src/canvas/ConnectedQuickAddMenu.tsx",
      "/src/canvas/LandingOutline.tsx",
      "/src/canvas/selection/useBoxSelection.ts",
    ])
      expect(
        modules.some((id) => id.endsWith(path)),
        path,
      ).toBe(false);
  });

  it("plays shedding without its inspector, fix authoring or tutorial UI", () => {
    for (const path of [
      "/src/canvas/inspector/QueueFields.tsx",
      "/src/canvas/inspector/PriorityField.tsx",
      "/src/live/session/useLiveFixes.ts",
      "/src/live/TroubleCallout.tsx",
      "/src/live/threadFixes.ts",
      "/src/live/resilienceFixPlan.ts",
    ])
      expect(
        modules.some((id) => id.endsWith(path)),
        path,
      ).toBe(false);
    expect(modules.filter((id) => /\/src\/tutorials\/(?!sandbox\.ts$)/.test(id))).toEqual([]);
    for (const path of ["/src/sim/shedQueue.ts", "/src/live/session/useLiveDiagramChanges.ts"])
      expect(
        modules.some((id) => id.endsWith(path)),
        path,
      ).toBe(true);
  });

  it("reuses the catalog's English stencil text without changing viewer words", () => {
    for (const stencil of catalog) {
      expect(viewerStencil.stencilLabel(stencil)).toBe(translatedStencil.stencilLabel(stencil));
      expect(viewerStencil.stencilDescription(stencil)).toBe(translatedStencil.stencilDescription(stencil));
      expect(viewerStencil.stencilSubtitle(stencil)).toBe(translatedStencil.stencilSubtitle(stencil));
      expect(viewerStencil.vendorLabel(stencil.vendor)).toBe(translatedStencil.vendorLabel(stencil.vendor));
    }
  });

  it("runs no architecture checks: no engine, card, markers or checks worker", () => {
    expect(
      modules.filter((id) => /[/\\]src[/\\](checks|canvas[/\\]checks[/\\](ChecksMarkers|runner))/.test(id)),
    ).toEqual([]);
    expect(template).not.toMatch(/name:\s*"checks"|checks\/worker/);
  });

  it("isolates storage before any other code names it", () => {
    // ./viewer/storage imports nothing and is imported first: in the script, the first mention of either
    // store is its list of what to replace, so no app module can read the browser's storage before it runs.
    const [script] = blocks(template, "script");
    const first = script.search(/localStorage|sessionStorage/);
    expect(script.slice(first - 1, first + 31)).toMatch(/^.localStorage.,\s*.sessionStorage./);
    expect(modules.find((id) => !id.startsWith("\0"))).toMatch(/src\/export\/viewer\/storage\.ts$/);
  });

  it("carries the placeholder once and every stencil's icon name", () => {
    expect(template.split(PAYLOAD_BLOCK)).toHaveLength(2);
    const icons = templateStencilIcons(template);
    expect(icons["kafka.topic"]).toBeTruthy();
    expect(Object.keys(icons).length).toBeGreaterThan(100);
  });

  it("is deterministic", async () => {
    const again = await buildViewerTemplate(resolve("."));
    expect(again === template).toBe(true);
  }, 120_000);

  it("exports the Kafka example with only its icons, keeping the hashes valid", () => {
    const diagram = JSON.parse(readFileSync(resolve("src/examples/kafka-order-pipeline.json"), "utf8"));
    const html = exportHtml(template, {
      diagram,
      iconSvgs: allIcons(),
      theme: "light",
      startSimulation: "black-friday",
      exportedOn: "2026-10-12",
    });
    // The script and style are untouched, so the policy (copied as is) still matches them.
    expect(csp(html)).toBe(csp(template));
    expect(blocks(html, "script")).toEqual(blocks(template, "script"));
    const icons = new Set(diagram.nodes.map((n: { stencil: string }) => templateStencilIcons(template)[n.stencil]));
    const carried = [...html.matchAll(/"([a-z0-9-]+)":"data:image\/svg\+xml,/g)].map((m) => m[1]);
    expect(new Set(carried)).toEqual(icons);
  });
});
