import { loadEnv, type Plugin } from "vite";

// The self-hosting switches, read once at build time (docs/SELF-HOSTING.md). `deploymentSwitches()` (in
// vite.config.ts) reads the VITE_* variables below, from the environment or a .env file, and defines the result
// as literals: `__DEPLOYMENT_SHARE_LINKS__` is `true` or `false`, never an expression. So src/lib/deployment.ts
// exports plain constants, the bundler inlines them where they're used (across chunks too), and the code a switch
// turns off is dropped from the build. Global constants, like __BUILD_SHA__, not `import.meta.env` keys: those
// would also land in the env object every `import.meta.env` read carries. Node-only: the app reads
// src/lib/deployment.ts.

/** On/off switches. Each is off unless set to 1 (or true, yes, on). */
export const DEPLOYMENT_SWITCHES = [
  "VITE_DISABLE_SHARE_LINKS",
  "VITE_DISABLE_LINK_OPEN",
  "VITE_DISABLE_AI_TOOLS",
  "VITE_DISABLE_ONDEVICE",
  "VITE_PRIVATE_BY_DEFAULT",
] as const;

export type DeploymentVariable = (typeof DEPLOYMENT_SWITCHES)[number] | "VITE_BRAND_NAME";

/** `pnpm build:internal`'s defaults: no links made here, no AI tools, new diagrams Private. */
export const INTERNAL_DEFAULTS: Partial<Record<DeploymentVariable, string>> = {
  VITE_DISABLE_SHARE_LINKS: "1",
  VITE_DISABLE_AI_TOOLS: "1",
  VITE_PRIVATE_BY_DEFAULT: "1",
};

export const DEFAULT_BRAND = "Live Diagrams";
/** The longest brand name the top bar and the title take; longer ones are cut. */
export const BRAND_MAX = 60;

/** What src/lib/deployment.ts exports, as one build sees it. */
export interface Deployment {
  shareLinks: boolean;
  linkOpen: boolean;
  aiTools: boolean;
  onDevice: boolean;
  /** The AI panel: AI tools or the on-device model. */
  aiPanel: boolean;
  privateByDefault: boolean;
  brandName: string;
}

const on = (value: string | undefined) => /^(1|true|yes|on)$/i.test((value ?? "").trim());

/** A brand name as shown: one line, trimmed, at most BRAND_MAX characters; the default when empty. */
export function brandName(value: string | undefined): string {
  const name = (value ?? "").replace(/\s+/g, " ").trim();
  return (name.length > BRAND_MAX ? name.slice(0, BRAND_MAX).trim() : name) || DEFAULT_BRAND;
}

/** The deployment the variables describe. No variables: the public site's. */
export function readDeployment(env: Record<string, string | undefined>): Deployment {
  return {
    shareLinks: !on(env.VITE_DISABLE_SHARE_LINKS),
    linkOpen: !on(env.VITE_DISABLE_LINK_OPEN),
    aiTools: !on(env.VITE_DISABLE_AI_TOOLS),
    onDevice: !on(env.VITE_DISABLE_ONDEVICE),
    aiPanel: !on(env.VITE_DISABLE_AI_TOOLS) || !on(env.VITE_DISABLE_ONDEVICE),
    privateByDefault: on(env.VITE_PRIVATE_BY_DEFAULT),
    brandName: brandName(env.VITE_BRAND_NAME),
  };
}

/** The global constants src/lib/deployment.ts reads, one per field. */
export const DEPLOYMENT_KEYS: Record<keyof Deployment, string> = {
  shareLinks: "__DEPLOYMENT_SHARE_LINKS__",
  linkOpen: "__DEPLOYMENT_LINK_OPEN__",
  aiTools: "__DEPLOYMENT_AI_TOOLS__",
  onDevice: "__DEPLOYMENT_ON_DEVICE__",
  aiPanel: "__DEPLOYMENT_AI_PANEL__",
  privateByDefault: "__DEPLOYMENT_PRIVATE_BY_DEFAULT__",
  brandName: "__DEPLOYMENT_BRAND_NAME__",
};

/** Vite `define` entries: every constant, always, as a literal (a build without them would fail to run). */
export function deploymentDefines(env: Record<string, string | undefined>): Record<string, string> {
  const d = readDeployment(env);
  return Object.fromEntries(
    (Object.keys(DEPLOYMENT_KEYS) as (keyof Deployment)[]).map((k) => [DEPLOYMENT_KEYS[k], JSON.stringify(d[k])]),
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * index.html with the brand name in the page title, the link-preview names and the start-up page's heading
 * (the top bar reads src/lib/deployment.ts). Unchanged for the default name.
 */
export function brandHtml(html: string, brand: string): string {
  if (!brand || brand === DEFAULT_BRAND) return html;
  const name = escapeHtml(brand);
  // Replacement functions, so a "$" in the name is just a character.
  const around = (_: string, before: string, after: string) => `${before}${name}${after}`;
  return html
    .replace(/(<title>)Live Diagrams(<\/title>)/, around)
    .replace(/(<meta (?:property|name)="(?:og:site_name|og:title|twitter:title)" content=")Live Diagrams(")/g, around)
    .replace(/(<h1>(?:<img [^>]*\/>)?)Live Diagrams(<\/h1>)/, around)
    .replace(/(<p>)Live Diagrams( needs JavaScript to run\.<\/p>)/, around);
}

/**
 * The switches as Vite config: every key defined (from the environment or a .env file), and the brand name in
 * index.html. Runs in builds, the dev server and Vitest alike.
 */
export function deploymentSwitches(): Plugin {
  let brand = DEFAULT_BRAND;
  return {
    name: "deployment-switches",
    config(config, { mode }) {
      const env = { ...loadEnv(mode, config.envDir || config.root || process.cwd(), "VITE_") };
      brand = readDeployment(env).brandName;
      return { define: deploymentDefines(env) };
    },
    transformIndexHtml: (html) => brandHtml(html, brand),
    generateBundle: {
      // After Vite's own steps have written the page and every chunk's preload list: they name files too.
      order: "post",
      handler(_options, bundle) {
        for (const name of unreachableFiles(bundle)) Reflect.deleteProperty(bundle, name);
      },
    },
  };
}

type BundleFile = { type: "chunk"; isEntry: boolean; code: string } | { type: "asset"; source: string | Uint8Array };

/**
 * Scripts and stylesheets nothing loads: no entry, page or loaded chunk names them. The bundler inlines a
 * switch's constant and drops the code behind it, `import()` included, but it has already split that import's
 * target into a chunk of its own (the WebMCP tools, say, or the AI panel and its CSS), which it still writes.
 * Nothing can load such a file, and a copy deployed without the feature shouldn't carry it. Any mention of a
 * file's name counts as a use, so this never drops a file that something might load; the public build has none.
 */
export function unreachableFiles(bundle: Record<string, BundleFile>): string[] {
  const base = (name: string) => name.slice(name.lastIndexOf("/") + 1);
  const text = (f: BundleFile) =>
    f.type === "chunk" ? f.code : typeof f.source === "string" ? f.source : Buffer.from(f.source).toString("utf8");
  const candidates = Object.keys(bundle).filter((name) => bundle[name].type === "chunk" || name.endsWith(".css"));
  const roots = Object.keys(bundle).filter((name) => {
    const f = bundle[name];
    return f.type === "chunk" ? f.isEntry : name.endsWith(".html");
  });
  const reached = new Set(roots);
  let waiting = candidates.filter((name) => !reached.has(name));
  const queue = [...roots];
  for (let next = queue.pop(); next !== undefined && waiting.length; next = queue.pop()) {
    const source = text(bundle[next]);
    const found = waiting.filter((name) => source.includes(base(name)));
    for (const name of found) reached.add(name);
    queue.push(...found);
    waiting = waiting.filter((name) => !reached.has(name));
  }
  return waiting;
}
