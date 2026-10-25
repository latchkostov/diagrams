import type { Rollup } from "vite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
  ["tutorial titles and catalog", /[/\\]src[/\\]tutorials[/\\](?:metadata\.ts$|catalog[/\\])/],
  [
    "example discovery details",
    /[/\\]src[/\\]examples[/\\](?:metadata\.ts|details\.ts|ExampleDetails\.tsx|GalleryDetails\.tsx)$/,
  ],
  ["production tutorial metadata", /[/\\]src[/\\]tutorials[/\\]metadata\.ts$/],
  ["route presentation and authoring", /[/\\]src[/\\]model[/\\]routingAppearance\.ts$/],
  ["resource playback arithmetic", /[/\\]src[/\\]model[/\\]resourceRuntime\.ts$/],
  ["AI authoring simulation schemas", /[/\\]src[/\\]model[/\\]aiSimProps\.ts$/],
  ["node settings container", /[/\\]src[/\\]canvas[/\\]inspector[/\\]NodeSettings\.tsx$/],
  ["autoscaling authoring presets", /[/\\]src[/\\]model[/\\]autoscalingLessons\.ts$/],
  ["settings paste and editing codecs", /[/\\]src[/\\]model[/\\]settingsInput\.ts$/],
  ["routing form helpers", /[/\\]src[/\\]model[/\\]routingEdits\.ts$/],
  ["selected-edge pointer adapter", /[/\\]src[/\\]canvas[/\\]interaction[/\\]usePointerGesture\.ts$/],
  [
    "route shaping controls",
    /[/\\]src[/\\]canvas[/\\]edges[/\\](?:EdgeRouteHandles\.tsx|segments\.ts|segmentKeyboard\.ts|useSegmentKeyboard\.ts)$/,
  ],
  ["saved-route authoring schema", /[/\\]src[/\\]model[/\\]edgeRouteSchema\.ts$/],
  ["saved-route image readiness", /[/\\]src[/\\]canvas[/\\]edges[/\\]imageReadiness\.ts$/],
  ["selection route reset", /[/\\]src[/\\]palette[/\\]routeActions\.ts$/],
  ["node simulation fields", /[/\\]src[/\\]canvas[/\\]inspector[/\\]SimulationFields\.tsx$/],
  ["slow-motion scrubber", /[/\\]src[/\\]live[/\\]slowmo[/\\]SlowTimeline\.tsx$/],
  ["stencil artwork URLs", /[/\\]src[/\\]stencils[/\\]iconUrls\.ts$/],
  ["message type inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]MessageFields\.tsx$/],
  ["message type picker", /[/\\]src[/\\]components[/\\]MessageTypePicker\.tsx$/],
  ["message type propagation", /[/\\]src[/\\]model[/\\]messageTypes\.ts$/],
  ["edge reconnect handles", /[/\\]src[/\\]canvas[/\\]edges[/\\]EdgeEnds\.tsx$/],
  ["edge inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]EdgePanel\.tsx$/],
  ["edge inspector loading and recovery", /[/\\]src[/\\]canvas[/\\]inspector[/\\]lazyEdgePanel\.tsx$/],
  ["node inspector identity fields", /[/\\]src[/\\]canvas[/\\]inspector[/\\]NodeIdentity\.tsx$/],
  ["connection dot resolver", /[/\\]src[/\\]canvas[/\\]interaction[/\\]connectTarget\.ts$/],
  ["dependency and deny details", /[/\\]src[/\\]canvas[/\\]edges[/\\]SettingsCard\.tsx$/],
  ["saved-route geometry", /[/\\]src[/\\]canvas[/\\]geometry[/\\](?:shaped|fixedNudge)\.ts$/],
  ["extended outline geometry", /[/\\]src[/\\]canvas[/\\]shapes[/\\]extendedGeometry\.ts$/],
  ["outline attachment sampling", /[/\\]src[/\\]canvas[/\\]shapes[/\\]attachmentGeometry\.ts$/],
  ["provider and format artwork", /[/\\]src[/\\]interop[/\\]ui[/\\]BrandGlyph\.tsx$/],
  ["boundary inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]GroupPanel\.tsx$/],
  ["custom colour picker", /[/\\]src[/\\]components[/\\]ColorPickerModal\.tsx$/],
  ["bulk inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]MultiPanel\.tsx$/],
  ["diagram inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]DiagramPanel\.tsx$/],
  ["connection inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]EdgePanel\.tsx$/],
  ["extended shape glyphs", /[/\\]src[/\\]components[/\\](?:ShapeIcon\.tsx|shapeIconPaths\.ts)$/],
  [
    "Markdown rendering and parsing",
    /[/\\]src[/\\]components[/\\]markdown[/\\](MarkdownView\.tsx|markdownParser\.ts)$/,
  ],
  ["inspector Markdown editing", /[/\\]src[/\\]components[/\\]markdown[/\\]MarkdownEditor\.tsx$/],
  ["annotation editing", /[/\\]src[/\\]canvas[/\\]nodes[/\\]AnnotationEditor\.tsx$/],
  ["annotation Markdown enhancement", /[/\\]src[/\\]canvas[/\\]nodes[/\\]AnnotationFormatting\.tsx$/],
  ["Markdown formatting keys", /[/\\]src[/\\]components[/\\]markdown[/\\]markdownKeys\.ts$/],
  ["stencil gallery descriptions", /[/\\]src[/\\]i18n[/\\]galleryChrome\.ts$/],
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
  [
    "hover and docked Live readouts",
    /[/\\]src[/\\]live[/\\](?:NodeDetails|HoverCard|HoverReadout|EdgeDetailSection|BreakerReadout|hoverSummary|lazyNodeSections|DockedLive|verdictSection)\.tsx?$/,
  ],
  ["custom property editing", /[/\\]src[/\\]canvas[/\\]inspector[/\\]PropsEditor\.tsx$/],
  ["fault execution and outage indexes", /[/\\]src[/\\]model[/\\]faultRuntime\.ts$/],
  ["fault display messages", /[/\\]src[/\\]model[/\\]faultWords\.ts$/],
  ["run-end result messages", /[/\\]src[/\\]live[/\\]runEndResult\.ts$/],
  ["recording", /[/\\]src[/\\]live[/\\]record[/\\]Recorder\.tsx$/],
  ["slow motion", /[/\\]src[/\\]live[/\\]slowmo[/\\]/],
  ["autoscaling execution", /[/\\]src[/\\]sim[/\\]autoscaling\.ts$/],
  ["KEDA execution", /[/\\]src[/\\]sim[/\\]keda\.ts$/],
  ["processor property resolution", /[/\\]src[/\\]sim[/\\]defaults\.ts$/],
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
  "codec",
  "colors",
  "examples",
  // Native validation and clipboard insertion share the parent-cycle sanitizer.
  // The bundler folds their persisted-resource validator into this same startup chunk.
  "groupHierarchy",
  "i18n",
  "index",
  "jsx-runtime",
  // Shared by the optional shape engines and menu artwork, while its loader stays preloaded.
  "lazyLoad",
  // Catalogue, roles, schema constants and file validation share one preloaded model chunk.
  "native",
  "preload-helper",
  "react",
  "react-dom",
  // Request routing R1's file grammar and bounds (src/model/requestRouting.ts): native validation refuses a bad
  // route table or mix on open. Matching, the engine and the routing inspector stay lazy.
  "requestRouting",
  // Expanded annotation modules share Rolldown's live-binding export helper with the loader.
  "rolldown-runtime",
  "size",
  "storage",
  "toast",
];

/** Not in the canvas's first view either: they load when used, or once the canvas is idle. */
const NOT_WITH_CANVAS = NOT_AT_STARTUP.filter(
  ([what]) =>
    ![
      "the canvas",
      "stencil artwork URLs",
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
    expect(plain().chunks.some((chunk) => chunk.code.includes("A mobile app talks to an API"))).toBe(false);
  });

  it("serves every stencil glyph as a separate, byte-preserved cached asset", () => {
    const files = readdirSync("src/stencils/icons").filter((name) => name.endsWith(".svg"));
    const emitted = assets.filter((a) => /^assets\/[\w-]{8}\.svg$/.test(a.fileName));
    expect(emitted).toHaveLength(files.length);
    for (const name of files) {
      const source = readFileSync(`src/stencils/icons/${name}`);
      const hash = createHash("sha256").update(source).digest("base64url").slice(0, 8);
      const asset = emitted.find((a) => a.fileName === `assets/${hash}.svg`);
      expect(asset, name).toBeDefined();
      expect(Buffer.from(asset!.source)).toEqual(source);
    }
  });

  it("loads the diagram loader at startup, preloaded with the entry, never as a lazy chunk", () => {
    // Opening any diagram (a stored one, a share link, an example, an embed) reads and checks it first, so the
    // loader and what it imports must arrive with the entry, never one round trip later.
    const set = startup();
    const ids = bundled(set).map((id) => id.replaceAll("\\", "/"));
    for (const module of [
      "src/interop/native.ts",
      "src/stencils/catalog.ts",
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

  it("defers optional canvas surfaces and capacity analysis until requested", () => {
    const canvasFeatures: [string, RegExp][] = [
      ["room presence", /[/\\]src[/\\]canvas[/\\]PresenceLayer\.tsx$/],
      ["editing tooltips", /[/\\]src[/\\]canvas[/\\]NodeTooltip\.tsx$/],
      ["check markers", /[/\\]src[/\\]canvas[/\\]checks[/\\]ChecksMarkers\.tsx$/],
    ];
    const liveFeatures: [string, RegExp][] = [
      [
        "capacity analysis",
        /[/\\]src[/\\](?:live[/\\]capacityView|sim[/\\](?:capacity|capacityPlanning|waitingPlan|admissionPlanning|resourcePlanning))\.ts$/,
      ],
      ["Live overflow items", /[/\\]src[/\\]live[/\\]LiveMoreItems\.tsx$/],
      ["edit-mode capacity", /[/\\]src[/\\]live[/\\]session[/\\]EditCapacity\.tsx$/],
    ];
    for (const build of [plain(), rooms]) {
      expect(found(bundled(closure([canvasChunk(build)], build)), canvasFeatures)).toEqual([]);
      const live = build.chunks.find((chunk) => chunk.name === "LiveSession")!;
      expect(found(bundled(closure([live], build)), liveFeatures)).toEqual([]);
      expect(found(bundled(build.chunks), [...canvasFeatures, ...liveFeatures])).toEqual(
        [...canvasFeatures, ...liveFeatures].map(([name]) => name),
      );
    }
  });

  it("keeps searchable menu and naming container code in the canvas first view", () => {
    for (const build of [plain(), rooms]) {
      const menuModules = bundled(build.chunks).filter((id) =>
        /[/\\]src[/\\](?:components[/\\](?:ContextMenu|MenuList)|canvas[/\\]inspector[/\\]NodePanel)\.tsx$/.test(id),
      );
      expect(menuModules.length).toBeGreaterThan(0);
      const canvasModules = bundled(closure([canvasChunk(build)], build));
      expect(menuModules.filter((id) => !canvasModules.includes(id))).toEqual([]);
    }
  });

  it("shares the lazy surface runtime without importing the canvas implementation", () => {
    for (const build of [plain(), rooms]) {
      const runtime = build.chunks.find((chunk) =>
        Object.keys(chunk.modules).some((id) => /[/\\]src[/\\]lib[/\\]lazySurface\.tsx$/.test(id)),
      );
      expect(runtime?.name).toBe("canvas-shared");
      expect([...closure([runtime!], build)].map((chunk) => chunk.name)).not.toContain("CanvasView");
    }
  });

  it("ships surface policies without Node test-driver module paths", () => {
    const canvas = [...closure([canvasChunk()])].map((chunk) => chunk.code).join("\n");
    expect(canvas).toContain("inspector.identity");
    expect(canvas).toContain("live.capacity-analysis");
    expect(canvas).not.toContain("canvas/inspector/NodeIdentity");
    expect(canvas).not.toContain("canvas/CanvasReadouts");
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
      expect(ids.some((id) => /[/\\]nodes[/\\]ShapeOutline\.tsx$/.test(id))).toBe(true);
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
      ["trouble detection and messages", /[/\\]src[/\\]live[/\\](?:troubleTracker|observedTrouble)\.ts$/],
      ["breaker inspector", /[/\\]src[/\\]canvas[/\\]inspector[/\\]BreakerFields\.tsx$/],
      ["call pill formatting", /[/\\]src[/\\]live[/\\]CallPills\.tsx$/],
    ];
    expect(found(bundled(closure([live!])), editor)).toEqual([]);
    // Keep the editor available on demand, rather than deleting it to satisfy the split.
    expect(found(bundled(chunks), editor)).toEqual(editor.map(([what]) => what));
  });

  it("opens Live without optional callouts or simulation verification oracles", () => {
    const optional: [string, RegExp][] = [
      ["simulation expectation results", /[/\\]src[/\\]live[/\\]ExpectationSummary\.tsx$/],
      ["capacity callout", /[/\\]src[/\\]live[/\\]BottleneckCallout\.tsx$/],
      ["callout placement", /[/\\]src[/\\]live[/\\]useFloatingPlacement\.ts$/],
      ["narration callout", /[/\\]src[/\\]live[/\\]NoteCallout\.tsx$/],
    ];
    const oracles: [string, RegExp][] = [
      ["resource, ledger and CPU oracles", /[/\\]src[/\\]sim[/\\]resourceInvariants\.ts$/],
    ];
    const recovery: [string, RegExp] = ["download recovery", /[/\\]src[/\\]live[/\\]TroubleDownloadError\.tsx$/];
    for (const build of [plain(), rooms]) {
      const live = build.chunks.find((c) => c.name === "LiveSession");
      expect(live).toBeDefined();
      expect(found(bundled(closure([live!], build)), [...optional, ...oracles])).toEqual([]);
      expect(found(bundled(build.chunks), optional)).toEqual(optional.map(([what]) => what));
      // What recovers a failed optional download ships with Live itself: its Retry never needs another download.
      expect(found(bundled(closure([live!], build)), [recovery])).toEqual(["download recovery"]);
      expect(found(bundled(build.chunks), oracles)).toEqual([]);
      // R3 lives inside the engine: module boundaries alone cannot detect a missing test-only guard.
      expect(
        build.chunks.filter((chunk) => chunk.code.includes("verifyResilience")).map((chunk) => chunk.name),
      ).toEqual([]);
    }
  });

  it("loads fault playback and outage lookup with Live, and run results with narration", () => {
    const live = chunks.find((c) => c.name === "LiveSession");
    expect(live).toBeDefined();
    expect(
      found(
        bundled(closure([live!])),
        NOT_AT_STARTUP.filter(([what]) => what === "slow-motion scrubber"),
      ),
    ).toEqual([]);
    const playback = NOT_AT_STARTUP.filter(([what]) =>
      ["fault execution and outage indexes", "fault display messages"].includes(what),
    );
    expect(found(bundled(closure([live!])), playback)).toEqual(playback.map(([what]) => what));
    const results = NOT_AT_STARTUP.filter(([what]) => what === "run-end result messages");
    expect(found(bundled(closure([live!])), results)).toEqual([]);
    const narration = chunks.find((c) => c.name === "NoteCallout");
    expect(narration).toBeDefined();
    expect(found(bundled(closure([narration!])), results)).toEqual(["run-end result messages"]);
  });

  it("omits the development focus journal's formatting from production canvas chunks", () => {
    for (const build of [plain(), rooms]) {
      for (const chunk of closure([canvasChunk(build)], build)) {
        expect(chunk.code).not.toContain("focus.result");
        expect(chunk.code).not.toContain("selection.committed:");
      }
    }
  });

  it("loads the trace card on demand, apart from the Live session", () => {
    const card: [string, RegExp][] = [["trace card", /[/\\]src[/\\]live[/\\]TraceCard\.tsx$/]];
    for (const build of [plain(), rooms]) {
      const live = build.chunks.find((c) => c.name === "LiveSession");
      expect(live).toBeDefined();
      expect(found(bundled(closure([live!], build)), card)).toEqual([]);
      expect(found(bundled(build.chunks), card)).toEqual(["trace card"]);
    }
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
    expect(bundled([room]).some((id) => /[/\\]src[/\\]collab[/\\]room[/\\]transport\.ts$/.test(id))).toBe(true);
    const sockets = [...new Set(room.code.match(/\bwss?:\/\/[A-Za-z0-9.-]+[^"'`\s,\]]*/g) ?? [])].sort();
    expect(sockets).toEqual([...APPROVED_TRACKERS].sort());
    expect([...new Set(room.code.match(/\bstuns?:[A-Za-z0-9.-]+(?::\d+)?/g) ?? [])]).toEqual([...APPROVED_STUN]);
    expect(room.code).not.toMatch(/\bturns?:[A-Za-z0-9.-]/);
  });
});
