import { resolve } from "node:path";
import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

// What the production build loads up front, checked on the real build: the code that only some sessions
// use stays out of the startup JavaScript (the entry and the chunks it preloads), and out of the canvas's
// first view too. Each pattern names a module that once was, or could easily be, imported statically.

/** Never in the startup JavaScript. */
const NOT_AT_STARTUP: [string, RegExp][] = [
  ["stencil display messages", /[/\\]src[/\\]i18n[/\\]stencils\.ts$/],
  ["File operation messages", /[/\\]src[/\\]interop[/\\]ui[/\\]fileMessages\.ts$/],
  ["canvas File actions", /[/\\]src[/\\]interop[/\\]fileActions\.ts$/],
  ["numeric planning formatters", /[/\\]src[/\\]i18n[/\\]format\.ts$/],
  ["planning explanations and profiles", /[/\\]src[/\\](?:planning[/\\](?!lazy\.tsx)|stencils[/\\]profiles\.ts$)/],
  ["the draw.io converter", /[/\\]src[/\\]interop[/\\]drawio[/\\]/],
  ["the Mermaid converter", /[/\\]src[/\\]interop[/\\]mermaid[/\\]/],
  ["the infrastructure importers (compose reader)", /[/\\]src[/\\]interop[/\\]infra[/\\]/],
  ["the AsyncAPI reader", /[/\\]src[/\\]interop[/\\]infra[/\\]asyncapi\.ts$/],
  ["the Kubernetes reader", /[/\\]src[/\\]interop[/\\]infra[/\\](?:kubernetes|k8sHosts|k8sSettings)\.ts$/],
  ["the Terraform reader", /[/\\]src[/\\]interop[/\\]infra[/\\](?:terraform|tfRefs|tfTypes)\.ts$/],
  ["the YAML parser", /[/\\]node_modules[/\\](\.pnpm[/\\][^/\\]+[/\\]node_modules[/\\])?yaml[/\\]/],
  ["the Import report", /[/\\]src[/\\]interop[/\\]ui[/\\]ImportReportDialog\.tsx$/],
  ["html-to-image (image export)", /[/\\]html-to-image[/\\]/],
  ["the image export", /[/\\]src[/\\]interop[/\\]image\.ts$/],
  ["password-link crypto", /[/\\]src[/\\]interop[/\\]shareCrypto\.ts$/],
  ["the password dialogs", /[/\\]src[/\\]interop[/\\]ui[/\\]passwordDialogs\.tsx$/],
  ["the import and export dialogs", /[/\\]src[/\\]interop[/\\]ui[/\\]dialogs\.tsx$/],
  ["the examples gallery", /[/\\]src[/\\]components[/\\]ExamplesDialog\.tsx$/],
  ["Your diagrams", /[/\\]src[/\\]components[/\\]LibraryDialog\.tsx$/],
  ["the embed viewer", /[/\\]src[/\\]interop[/\\]embed[/\\]/],
  ["the Interactive HTML export", /[/\\]src[/\\]export[/\\]/],
  ["the Lab", /[/\\]src[/\\]lab[/\\]/],
  // Collaboration (C0 is Lab-only: a production build has none of it). Rooms, their crypto and Yjs load on use.
  ["collaboration", /[/\\]src[/\\]collab[/\\]/],
  ["Yjs", /[/\\]node_modules[/\\](\.pnpm[/\\][^/\\]+[/\\]node_modules[/\\])?(yjs|lib0)[/\\]/],
  ["the live session", /[/\\]src[/\\]live[/\\]LiveSession\.tsx$/],
  ["recording", /[/\\]src[/\\]live[/\\]record[/\\]Recorder\.tsx$/],
  ["slow motion", /[/\\]src[/\\]live[/\\]slowmo[/\\]/],
  ["autoscaling execution", /[/\\]src[/\\]sim[/\\]autoscaling\.ts$/],
  ["KEDA execution", /[/\\]src[/\\]sim[/\\]keda\.ts$/],
  ["the simulation engine", /[/\\]src[/\\]sim[/\\]engine\.ts$/],
  ["the architecture checks", /[/\\]src[/\\]checks[/\\]/],
  ["the AI panel", /[/\\]src[/\\]ai[/\\]ui[/\\]AiPanel\.tsx$/],
  ["the command palette's search", /[/\\]src[/\\]palette[/\\]PaletteDialog\.tsx$/],
  ["the stencil search index", /[/\\]src[/\\]lib[/\\]stencil(?:Display)?Search\.ts$/],
  ["the canvas", /[/\\]src[/\\]canvas[/\\]CanvasView\.tsx$/],
  ["React Flow", /[/\\]@xyflow[/\\]/],
];

/**
 * The entry and every chunk index.html preloads with it (fetched in parallel, no round trip between them). The
 * diagram loader (native, codec, annotations, checks' model) sits in chunks of its own, preloaded: since the
 * password token module (src/interop/encryptedToken.ts) became a second static importer of native and codec, the
 * bundler no longer folds them into the entry. The privacy gates (src/lib/localOnly.ts) were a preloaded chunk of
 * their own until the File menu stopped importing them (Share… replaced its link rows): the bundler folds them into
 * the entry now, one request fewer at startup for the same code. The i18n runtime (src/i18n/index.ts: the message
 * lookup and the language store, about 0.3 kB) is a chunk of its own for the same reason as storage and toast: the
 * entry and the lazy dialogs both import it.
 */
const STARTUP_CHUNKS = [
  "annotations",
  "catalog",
  "checks",
  "codec",
  "colors",
  "examples",
  // Native validation and clipboard insertion share the parent-cycle sanitizer.
  // The bundler folds their persisted-resource validator into this same startup chunk.
  "groupHierarchy",
  "i18n",
  "index",
  "jsx-runtime",
  // Native broker and load-balancer binding validation shares this chunk with the resource schema and the
  // shared native/engine lifecycle-budget preflight (A3 folded the former resourceBudget chunk into it); no
  // controller execution at startup.
  "kedaBindings",
  "native",
  "preload-helper",
  "react",
  "react-dom",
  "registry",
  // Request routing R1's file grammar and bounds (src/model/requestRouting.ts): native validation refuses a bad
  // route table or mix on open. Matching, the engine and the routing inspector stay lazy.
  "requestRouting",
  "size",
  "storage",
  "toast",
];

/** Not in the canvas's first view either: they load when used, or once the canvas is idle. */
const NOT_WITH_CANVAS = NOT_AT_STARTUP.filter(
  ([what]) =>
    ![
      "the canvas",
      "React Flow",
      "the stencil search index",
      "canvas File actions",
      "stencil display messages",
    ].includes(what),
);

let chunks: Rollup.OutputChunk[];
let assets: Rollup.OutputAsset[];
let html: string;

beforeAll(async () => {
  // A production build, as `pnpm build` makes it (Vitest runs with NODE_ENV=test, which Vite reads as development).
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({ configFile: resolve("vite.config.ts"), logLevel: "silent", build: { write: false } });
  } finally {
    process.env.NODE_ENV = env;
  }
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  chunks = output.filter((out): out is Rollup.OutputChunk => out.type === "chunk");
  assets = output.filter((out): out is Rollup.OutputAsset => out.type === "asset");
  const page = output.find((out): out is Rollup.OutputAsset => out.type === "asset" && out.fileName === "index.html");
  html = String(page?.source ?? "");
}, 120_000);

const chunk = (fileName: string) => {
  const found = chunks.find((c) => c.fileName === fileName);
  if (!found) throw new Error(`No chunk ${fileName}`);
  return found;
};
/** `from` and every chunk they import statically: what loads together with them. */
function closure(from: Rollup.OutputChunk[]): Set<Rollup.OutputChunk> {
  const seen = new Set<Rollup.OutputChunk>();
  for (const stack = [...from]; stack.length;) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...c.imports.map(chunk));
  }
  return seen;
}
const bundled = (set: Iterable<Rollup.OutputChunk>) =>
  [...set].flatMap((c) =>
    Object.entries(c.modules)
      .filter(([, m]) => m.renderedLength > 0)
      .map(([id]) => id),
  );
const found = (ids: string[], list: [string, RegExp][]) =>
  list.filter(([, pattern]) => ids.some((id) => pattern.test(id))).map(([what]) => what);

const startup = () => {
  const src = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1].replace(/^\.\//, ""));
  const entry = src(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/g);
  expect(entry).toHaveLength(1);
  const preloaded = src(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g);
  const set = closure([chunk(entry[0])]);
  // index.html preloads exactly what the entry imports statically.
  expect(new Set([...set].map((c) => c.fileName))).toEqual(new Set([...entry, ...preloaded]));
  return set;
};
const canvasChunk = () => {
  const canvas = chunks.find((c) => c.name === "CanvasView");
  if (!canvas) throw new Error("No CanvasView chunk");
  return canvas;
};

describe("production bundle split", () => {
  it("omits collaboration, Yjs and tracker code from every production chunk", () => {
    const collab = NOT_AT_STARTUP.filter(([what]) => ["collaboration", "Yjs"].includes(what));
    expect(found(bundled(chunks), collab)).toEqual([]);
    for (const c of chunks) {
      expect(c.code).not.toMatch(/tracker\.(?:webtorrent\.dev|openwebtorrent\.com|btorrent\.xyz)/);
      expect(c.code).not.toContain("stun:stun.cloudflare.com");
    }
  });

  it("ships the upstream MIT notice with the ported image exporter", () => {
    const image = chunks.find((c) =>
      Object.keys(c.modules).some((id) => /[/\\]src[/\\]interop[/\\]imageClone\.ts$/.test(id)),
    );
    if (!image) throw new Error("No image clone chunk");
    expect(image.code.includes("Copyright (c) 2017-2025 W.Y."), "upstream copyright notice").toBe(true);
    expect(image.code.includes("Permission is hereby granted, free of charge"), "upstream permission notice").toBe(
      true,
    );
    expect(image.code.includes('THE SOFTWARE IS PROVIDED "AS IS"'), "upstream warranty disclaimer").toBe(true);
  });

  it("keeps code that isn't needed for the first view out of the startup JavaScript", () => {
    expect(found(bundled(startup()), NOT_AT_STARTUP)).toEqual([]);
  });

  it("loads the diagram loader at startup, preloaded with the entry, never as a lazy chunk", () => {
    // Opening any diagram (a stored one, a share link, an example, an embed) reads and checks it first, so the
    // loader and what it imports must arrive with the entry, never one round trip later.
    const set = startup();
    const ids = bundled(set).map((id) => id.replaceAll("\\", "/"));
    for (const module of [
      "src/interop/native.ts",
      "src/interop/codec.ts",
      "src/model/annotations.ts",
      "src/model/resourceValidation.ts",
    ])
      expect(
        ids.some((id) => id.endsWith(module)),
        module,
      ).toBe(true);
    // The startup chunks, pinned: the bundler moving a module into the entry or out of it (as the password token
    // module once moved the loader into chunks of its own, still preloaded) changes this list, and has to be
    // looked at. The names are the bundler's; update the list deliberately, checking the network panel.
    expect([...set].map((c) => c.name).sort()).toEqual(STARTUP_CHUNKS);
  });

  it("loads the canvas without the live session, the converters or the dialogs", () => {
    const canvas = closure([canvasChunk()]);
    expect(found(bundled(canvas), NOT_WITH_CANVAS)).toEqual([]);
    // The canvas, React Flow included, and what it shares with code that loads without it: two chunks,
    // not a dozen small ones that the first view queues for.
    const loading = [...canvas].filter((c) => !startup().has(c));
    expect(loading.map((c) => c.name).sort()).toEqual(["CanvasView", "canvas-shared"]);
  });

  it("opens Live without the simulation editor and drill preset controls", () => {
    const live = chunks.find((c) => c.name === "LiveSession");
    expect(live).toBeDefined();
    const editor: [string, RegExp][] = [
      ["simulation editor", /[/\\]src[/\\]live[/\\]SimPanel\.tsx$/],
      ["fault step editor", /[/\\]src[/\\]live[/\\]FaultStep\.tsx$/],
      ["drill presets", /[/\\]src[/\\]live[/\\]faults\.ts$/],
      ["simulation warnings", /[/\\]src[/\\]live[/\\]validate\.ts$/],
    ];
    expect(found(bundled(closure([live!])), editor)).toEqual([]);
    // Keep the editor available on demand, rather than deleting it to satisfy the split.
    expect(found(bundled(chunks), editor)).toEqual(editor.map(([what]) => what));
  });

  it("builds the Interactive HTML viewer apart: a file of its own, fetched only by the export", () => {
    const template = assets.filter((a) => /^export\/interactive-viewer-[0-9a-f]{10}\.html$/.test(a.fileName));
    expect(template).toHaveLength(1);
    // Only the export's own lazy chunk names the file; the startup JavaScript doesn't.
    const naming = chunks.filter((c) => c.code.includes(template[0].fileName));
    expect(naming).toHaveLength(1);
    expect(startup().has(naming[0])).toBe(false);
    expect(bundled([naming[0]]).some((id) => /[/\\]src[/\\]export[/\\]exportHtml\.ts$/.test(id))).toBe(true);
    // None of the viewer's own modules (its entry, its sandbox, its icon map) is in the app's chunks.
    const viewerOnly = /[/\\]src[/\\]export[/\\](viewerEntry|viewer[/\\])/;
    expect(bundled(chunks).filter((id) => viewerOnly.test(id))).toEqual([]);
  });

  it("opens the stencil library, the command palette and Your diagrams without the canvas", () => {
    for (const name of ["GalleryView", "PaletteDialog", "LibraryDialog"]) {
      const view = chunks.find((c) => c.name === name);
      expect(view, name).toBeDefined();
      expect(closure([view!]).has(canvasChunk()), name).toBe(false);
    }
  });
});
