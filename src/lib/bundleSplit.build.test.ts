import type { Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { APPROVED_STUN, APPROVED_TRACKERS } from "../../scripts/deployment-env";
import { selfHostHeaderManifest } from "../../scripts/self-host-headers";
import { productionBuild } from "../test/productionBuild";

// What the production build loads up front, checked on the real build: the code that only some sessions
// use stays out of the startup JavaScript (the entry and the chunks it preloads), and out of the canvas's
// first view too. Each pattern names a module that once was, or could easily be, imported statically.
// Two builds: without Edit together (VITE_ENABLE_COLLAB unset, every copy's default), which carries none of it,
// and with it (livediagrams.dev's), where rooms, Yjs and the room's endpoints load only on use.

/** Never in the startup JavaScript. */
const NOT_AT_STARTUP: [string, RegExp][] = [
  [
    "Markdown rendering and parsing",
    /[/\\]src[/\\]components[/\\]markdown[/\\](MarkdownView\.tsx|markdownParser\.ts)$/,
  ],
  ["inspector Markdown editing", /[/\\]src[/\\]components[/\\]markdown[/\\]MarkdownEditor\.tsx$/],
  ["annotation editing", /[/\\]src[/\\]canvas[/\\]nodes[/\\]AnnotationEditor\.tsx$/],
  ["annotation Markdown enhancement", /[/\\]src[/\\]canvas[/\\]nodes[/\\]AnnotationFormatting\.tsx$/],
  ["Markdown formatting keys", /[/\\]src[/\\]components[/\\]markdown[/\\]markdownKeys\.ts$/],
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
  // Collaboration: none of it without VITE_ENABLE_COLLAB; with it, rooms, their crypto and Yjs load on use.
  ["collaboration", /[/\\]src[/\\]collab[/\\]/],
  ["Yjs", /[/\\]node_modules[/\\](\.pnpm[/\\][^/\\]+[/\\]node_modules[/\\])?(yjs|lib0)[/\\]/],
  ["the live session", /[/\\]src[/\\]live[/\\]LiveSession\.tsx$/],
  ["custom property editing", /[/\\]src[/\\]canvas[/\\]inspector[/\\]PropsEditor\.tsx$/],
  ["fault execution and outage indexes", /[/\\]src[/\\]model[/\\]faultRuntime\.ts$/],
  ["fault display messages", /[/\\]src[/\\]model[/\\]faultWords\.ts$/],
  ["run-end result messages", /[/\\]src[/\\]live[/\\]runEndResult\.ts$/],
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
      // Inline editing must take the very first key after a double-click, including caret movement.
      "annotation editing",
    ].includes(what),
);

interface Build {
  chunks: Rollup.OutputChunk[];
  assets: Rollup.OutputAsset[];
  html: string;
}

let chunks: Rollup.OutputChunk[];
let assets: Rollup.OutputAsset[];
let html: string;
/** The build with Edit together on (VITE_ENABLE_COLLAB=1), as livediagrams.dev builds. */
let rooms: Build;

/**
 * What a self-hoster's shell or .env might set: the fixtures must not see it (productionBuild clears every
 * deployment variable and reads no .env file), so both still build the defaults, the approved endpoints included.
 */
const AMBIENT = {
  VITE_ENABLE_COLLAB: "1",
  VITE_COLLAB_TRACKERS: "wss://tracker.intranet.example",
  VITE_COLLAB_STUN: "none",
};

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, AMBIENT);
  try {
    ({ chunks, assets, html } = await productionBuild({}));
    rooms = await productionBuild({ VITE_ENABLE_COLLAB: "1" });
  } finally {
    for (const key of Object.keys(AMBIENT)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, saved);
  }
}, 240_000);

/** The build without Edit together: every copy's default. */
const plain = (): Build => ({ chunks, assets, html });

const chunkIn = (b: Build, fileName: string) => {
  const found = b.chunks.find((c) => c.fileName === fileName);
  if (!found) throw new Error(`No chunk ${fileName}`);
  return found;
};
/** `from` and every chunk they import statically: what loads together with them. */
function closure(from: Rollup.OutputChunk[], b: Build = plain()): Set<Rollup.OutputChunk> {
  const seen = new Set<Rollup.OutputChunk>();
  for (const stack = [...from]; stack.length;) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...c.imports.map((name) => chunkIn(b, name)));
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

const startup = (b: Build = plain()) => {
  const src = (re: RegExp) => [...b.html.matchAll(re)].map((m) => m[1].replace(/^\.\//, ""));
  const entry = src(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/g);
  expect(entry).toHaveLength(1);
  const preloaded = src(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g);
  const set = closure([chunkIn(b, entry[0])], b);
  // index.html preloads exactly what the entry imports statically.
  expect(new Set([...set].map((c) => c.fileName))).toEqual(new Set([...entry, ...preloaded]));
  return set;
};
const canvasChunk = (b: Build = plain()) => {
  const canvas = b.chunks.find((c) => c.name === "CanvasView");
  if (!canvas) throw new Error("No CanvasView chunk");
  return canvas;
};

describe("production bundle split", () => {
  it("emits the generated self-host header policy as runtime data", () => {
    const manifest = assets.find((asset) => asset.fileName === "headers.json");
    expect(JSON.parse(String(manifest?.source))).toEqual(selfHostHeaderManifest());
  });
  it("without Edit together, omits collaboration, Yjs and tracker code from every chunk", () => {
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

  it("loads the Markdown parser with its view, without the editor or its keys", () => {
    const view = chunks.find((c) =>
      Object.keys(c.modules).some((id) => /[/\\]markdown[/\\]MarkdownView\.tsx$/.test(id)),
    );
    expect(view).toBeDefined();
    expect(Object.keys(view!.modules).some((id) => /[/\\]markdownParser\.ts$/.test(id))).toBe(true);
    const editing = NOT_AT_STARTUP.filter(([what]) =>
      ["inspector Markdown editing", "annotation editing", "Markdown formatting keys"].includes(what),
    );
    expect(found(bundled(closure([view!])), editing)).toEqual([]);
    expect(found(bundled(chunks), editing)).toEqual([
      "inspector Markdown editing",
      "annotation editing",
      "Markdown formatting keys",
    ]);
  });

  it("keeps the plain annotation editor in the canvas while its formatting downloads separately", () => {
    for (const build of [plain(), rooms]) {
      const ids = bundled(closure([canvasChunk(build)], build));
      expect(ids.some((id) => /[/\\]nodes[/\\]AnnotationEditor\.tsx$/.test(id))).toBe(true);
      expect(ids.some((id) => /[/\\](AnnotationFormatting\.tsx|markdownKeys\.ts)$/.test(id))).toBe(false);
      expect(bundled(build.chunks).some((id) => /[/\\]nodes[/\\]AnnotationFormatting\.tsx$/.test(id))).toBe(true);
    }
  });

  it("opens Live without the simulation editor and drill preset controls", () => {
    const live = chunks.find((c) => c.name === "LiveSession");
    expect(live).toBeDefined();
    const editor: [string, RegExp][] = [
      ["event log", /[/\\]src[/\\]live[/\\]EventLog\.tsx$/],
      ["custom injection", /[/\\]src[/\\]live[/\\]InjectDialog\.tsx$/],
      ["simulation editor", /[/\\]src[/\\]live[/\\]SimPanel\.tsx$/],
      ["fault step editor", /[/\\]src[/\\]live[/\\]FaultStep\.tsx$/],
      ["drill presets", /[/\\]src[/\\]live[/\\]faults\.ts$/],
      ["simulation warnings", /[/\\]src[/\\]live[/\\]validate\.ts$/],
    ];
    expect(found(bundled(closure([live!])), editor)).toEqual([]);
    // Keep the editor available on demand, rather than deleting it to satisfy the split.
    expect(found(bundled(chunks), editor)).toEqual(editor.map(([what]) => what));
  });

  it("loads fault playback, outage lookup and run results with the Live session", () => {
    const live = chunks.find((c) => c.name === "LiveSession");
    expect(live).toBeDefined();
    const playback = NOT_AT_STARTUP.filter(([what]) =>
      ["fault execution and outage indexes", "fault display messages", "run-end result messages"].includes(what),
    );
    expect(found(bundled(closure([live!])), playback)).toEqual(playback.map(([what]) => what));
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

describe("production bundle split with Edit together on (VITE_ENABLE_COLLAB=1)", () => {
  const collab = NOT_AT_STARTUP.filter(([what]) => ["collaboration", "Yjs"].includes(what));
  const TRACKER_HOSTS = /\btracker\.(?:webtorrent\.dev|openwebtorrent\.com|btorrent\.xyz)\b/;

  it("bundle fixtures ignore ambient collaboration settings", () => {
    // Built while AMBIENT asked for rooms and named other endpoints: the default build has none, the rooms build
    // the approved ones (the endpoint test below).
    expect(found(bundled(chunks), collab)).toEqual([]);
    for (const c of [...chunks, ...rooms.chunks]) expect(c.code).not.toContain("tracker.intranet.example");
  });

  it("carries rooms and Yjs (so the checks below can fail)", () => {
    expect(found(bundled(rooms.chunks), collab)).toEqual(["collaboration", "Yjs"]);
  });

  it("keeps them, and everything else lazy, out of the startup JavaScript, pinned to the same chunks", () => {
    expect(found(bundled(startup(rooms)), NOT_AT_STARTUP)).toEqual([]);
    expect([...startup(rooms)].map((c) => c.name).sort()).toEqual(STARTUP_CHUNKS);
  });

  it("keeps them out of the canvas's first view", () => {
    const canvas = closure([canvasChunk(rooms)], rooms);
    expect(found(bundled(canvas), NOT_WITH_CANVAS)).toEqual([]);
    const loading = [...canvas].filter((c) => !startup(rooms).has(c));
    expect(loading.map((c) => c.name).sort()).toEqual(["CanvasView", "canvas-shared"]);
  });

  it("names the endpoints in the room's own chunk only: exactly the approved trackers and STUN, no TURN", () => {
    const naming = rooms.chunks.filter((c) => TRACKER_HOSTS.test(c.code) || c.code.includes("stun:"));
    expect(naming).toHaveLength(1);
    const [room] = naming;
    expect(startup(rooms).has(room)).toBe(false);
    expect(closure([canvasChunk(rooms)], rooms).has(room)).toBe(false);
    expect(bundled([room]).some((id) => /[/\\]src[/\\]collab[/\\]room[/\\]endpoints\.ts$/.test(id))).toBe(true);
    const sockets = [...new Set(room.code.match(/\bwss?:\/\/[A-Za-z0-9.-]+[^"'`\s,\]]*/g) ?? [])].sort();
    expect(sockets).toEqual([...APPROVED_TRACKERS].sort());
    expect([...new Set(room.code.match(/\bstuns?:[A-Za-z0-9.-]+(?::\d+)?/g) ?? [])]).toEqual([...APPROVED_STUN]);
    expect(room.code).not.toMatch(/\bturns?:[A-Za-z0-9.-]/);
  });
});
