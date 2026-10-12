// Interactive HTML export: turning the viewer template into one diagram's file. Pure string work with no
// imports and no browser or Node APIs, so the app (src/export/exportHtml.ts) and an offline Node script
// (the agent skill's export) produce byte-identical files from the same template and inputs.
//
// The template (built by scripts/interactive-viewer.ts, served as export/interactive-viewer-<hash>.html) is a
// complete HTML page: the viewer's script and styles inline, a strict Content-Security-Policy whose script
// and style hashes cover exactly that inline code, and two JSON data blocks:
//   <script type="application/json" id="ld-stencil-icons">{"kafka.topic":"kafka",…}</script>
//       stencil id → icon name, for subsetting icons without the catalog;
//   <script type="application/json" id="diagram">__LIVE_DIAGRAMS_PAYLOAD__</script>
//       the placeholder this module fills.
// Data blocks never run, so neither the payload nor the icons change the CSP: the hashes stay valid.

/** The placeholder inside the template's `#diagram` data block. */
export const PAYLOAD_PLACEHOLDER = "__LIVE_DIAGRAMS_PAYLOAD__";
/** The data block as the template carries it, placeholder included. */
export const PAYLOAD_BLOCK = `<script type="application/json" id="diagram">${PAYLOAD_PLACEHOLDER}</script>`;
/** The stencil id → icon name block's opening tag. */
export const STENCIL_ICONS_OPEN = `<script type="application/json" id="ld-stencil-icons">`;
/** The icon unknown stencils (and stencils whose icon is missing) fall back to (src/stencils/registry.ts). */
export const FALLBACK_ICON = "generic-box";
/** The payload's format; the viewer refuses others. */
export const PAYLOAD_VERSION = 1;

/** A diagram (diagrams/v1) as the file carries it, whole: only what this module reads is typed here. */
export interface PayloadDiagram {
  title: string;
  nodes: readonly { stencil: string }[];
  simulations?: readonly { id: string; title: string }[];
}

export interface ViewerOptions {
  theme: "light" | "dark";
  /** A line shown above the diagram, e.g. "Confidential: internal use only". */
  banner?: string;
  /** The simulation that plays when the file opens; null opens the static diagram. */
  startSimulation: string | null;
  /** When it was exported, as an ISO date (YYYY-MM-DD): the footer says so. */
  exportedOn: string;
}

export interface ExportPayload {
  version: typeof PAYLOAD_VERSION;
  diagram: PayloadDiagram;
  /** Icon name → data: URI, only the icons the diagram uses. */
  icons: Record<string, string>;
  options: ViewerOptions;
}

export interface ExportInput {
  diagram: PayloadDiagram;
  /** Icon name → SVG text (all of them or just the used ones: only the used ones go in). */
  iconSvgs: Readonly<Record<string, string>>;
  theme: "light" | "dark";
  banner?: string;
  /** The page's title (the diagram's title by default). */
  title?: string;
  /** Simulation ids to keep (in the diagram's order); undefined keeps all of them. */
  simulations?: readonly string[];
  /** The one that plays at once, if any (ignored unless it's kept). */
  startSimulation?: string | null;
  /** Default: today (local time). Pass it for reproducible output. */
  exportedOn?: string;
}

/** JSON that is safe inside a `<script>` element: no `<` at all (so no `</script>` or `<!--`), no U+2028/9. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Text for an HTML element's content or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** An SVG as a data: URI. Percent-encoded rather than base64: smaller for text, and needs no btoa or Buffer. */
export function svgDataUri(svg: string): string {
  const compact = svg.replace(/^\uFEFF/, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
}

/** The stencil id → icon name map a template carries. */
export function templateStencilIcons(template: string): Record<string, string> {
  const start = template.indexOf(STENCIL_ICONS_OPEN);
  if (start < 0) throw new Error("This isn't an interactive viewer template: it has no stencil icon map.");
  const from = start + STENCIL_ICONS_OPEN.length;
  const end = template.indexOf("</script>", from);
  return JSON.parse(template.slice(from, end)) as Record<string, string>;
}

/**
 * The icons `diagram` shows, as data URIs: each node's stencil icon, and the fallback box when a stencil is
 * unknown or its icon isn't in `iconSvgs`. Sorted by name, so the output doesn't depend on node order.
 */
export function subsetIcons(
  diagram: PayloadDiagram,
  stencilIcons: Readonly<Record<string, string>>,
  iconSvgs: Readonly<Record<string, string>>,
): Record<string, string> {
  const used = new Set<string>();
  for (const node of diagram.nodes) {
    const icon = Object.hasOwn(stencilIcons, node.stencil) ? stencilIcons[node.stencil] : undefined;
    used.add(icon && Object.hasOwn(iconSvgs, icon) ? icon : FALLBACK_ICON);
  }
  const out: Record<string, string> = {};
  for (const name of [...used].sort()) if (Object.hasOwn(iconSvgs, name)) out[name] = svgDataUri(iconSvgs[name]);
  return out;
}

/** Today as YYYY-MM-DD, local time. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What the file carries: the diagram (with its title and chosen simulations), the used icons and the options. */
export function buildPayload(template: string, input: ExportInput): ExportPayload {
  const keep = input.simulations ? new Set(input.simulations) : undefined;
  const simulations = (input.diagram.simulations ?? []).filter((s) => !keep || keep.has(s.id));
  const title = (input.title ?? input.diagram.title).trim() || input.diagram.title;
  const diagram: PayloadDiagram = { ...input.diagram, title };
  if (input.diagram.simulations || simulations.length) diagram.simulations = simulations;
  const start = input.startSimulation ?? null;
  const banner = input.banner?.trim();
  return {
    version: PAYLOAD_VERSION,
    diagram,
    icons: subsetIcons(diagram, templateStencilIcons(template), input.iconSvgs),
    options: {
      theme: input.theme,
      ...(banner ? { banner } : {}),
      startSimulation: start && simulations.some((s) => s.id === start) ? start : null,
      exportedOn: input.exportedOn ?? today(),
    },
  };
}

/**
 * The template with `payload` in its data block, the page's `<title>` and its theme (so the first paint,
 * before the script runs, already has the right background). Throws if the template isn't one.
 */
export function injectPayload(template: string, payload: ExportPayload): string {
  const at = template.indexOf(PAYLOAD_BLOCK);
  if (at < 0 || template.indexOf(PAYLOAD_BLOCK, at + 1) >= 0)
    throw new Error("This isn't an interactive viewer template: it needs exactly one payload placeholder.");
  const block = PAYLOAD_BLOCK.replace(PAYLOAD_PLACEHOLDER, () => scriptSafeJson(payload));
  const head = template
    .slice(0, at)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(payload.diagram.title)}</title>`)
    .replace(
      /(<html\b[^>]*\bdata-theme=")[a-z]+(")/,
      (_, open: string, close: string) => open + payload.options.theme + close,
    );
  return head + block + template.slice(at + PAYLOAD_BLOCK.length);
}

/** One call: the finished file's text. */
export function exportHtml(template: string, input: ExportInput): string {
  return injectPayload(template, buildPayload(template, input));
}

/** `<title>.html`, with the characters file systems reject taken out. */
export function htmlFileName(title: string): string {
  const name = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120)
    .trim();
  return `${name || "diagram"}.html`;
}

/**
 * The page's Content-Security-Policy, given the base64 sha256 of its one inline script and one inline style
 * (computed by the template build). Every directive is the strictest that still works:
 *  - default-src 'none': nothing loads unless listed; connect-src 'none' says so twice: no requests at all.
 *  - script-src and style-src by hash: only the template's own code and styles, never 'unsafe-inline'.
 *  - img-src data: blob: the icons are data URIs; font-src data: the inlined fonts.
 *  - media-src blob: Record video's preview of the recording made in the page.
 *  - no worker-src: the particles draw on the main thread (see scripts/interactive-viewer.ts).
 *  - base-uri, form-action and object-src 'none'. (frame-ancestors can't be set from a meta tag: who may
 *    frame the file is the host's call, which is what hosting it inside the company means.)
 */
export function viewerCsp(scriptHash: string, styleHash: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    "img-src data: blob:",
    "font-src data:",
    "media-src blob:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
}
