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
  // Edit together (rooms): opt-in. On for livediagrams.dev (its build settings set it), off for every other copy
  // unless it sets it. Never without share links (a room is a kind of link).
  "VITE_ENABLE_COLLAB",
] as const;

/**
 * Where a room finds the others (collaboration plan Q9): a self-hosted copy may name its own matchmaking trackers,
 * STUN and TURN servers, at build time only. Unset, the approved public set (APPROVED_TRACKERS, APPROVED_STUN) and no
 * TURN: what livediagrams.dev uses, and nothing else without the owner's approval.
 *  - VITE_COLLAB_TRACKERS: wss:// WebTorrent tracker URLs, separated by commas or spaces.
 *  - VITE_COLLAB_STUN: stun: (or stuns:) URLs, or "none" for no STUN server.
 *  - VITE_COLLAB_TURN, with VITE_COLLAB_TURN_USERNAME and VITE_COLLAB_TURN_CREDENTIAL: turn: (or turns:) URLs. The
 *    username and credential are in the page for anyone who can open it, like every other build value.
 */
export const COLLAB_VARIABLES = [
  "VITE_COLLAB_TRACKERS",
  "VITE_COLLAB_STUN",
  "VITE_COLLAB_TURN",
  "VITE_COLLAB_TURN_USERNAME",
  "VITE_COLLAB_TURN_CREDENTIAL",
] as const;

export type DeploymentVariable =
  (typeof DEPLOYMENT_SWITCHES)[number] | (typeof COLLAB_VARIABLES)[number] | "VITE_BRAND_NAME" | "VITE_LOCALES";
export const DEPLOYMENT_VARIABLES: DeploymentVariable[] = [
  ...DEPLOYMENT_SWITCHES,
  ...COLLAB_VARIABLES,
  "VITE_BRAND_NAME",
  "VITE_LOCALES",
];

/**
 * The approved public matchmaking trackers and STUN server (collaboration plan §2.8, the owner's decision): exactly
 * these, and no TURN, unless the owner approves a change. src/collab/transport/tracker.ts names the same
 * (policy.test.ts checks), and the public site's connect-src allows exactly these trackers (security-headers.ts).
 */
export const APPROVED_TRACKERS: readonly string[] = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.webtorrent.dev",
];
export const APPROVED_STUN: readonly string[] = ["stun:stun.cloudflare.com:3478"];

/** An ICE server as RTCPeerConnection takes it. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

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
  /** The languages offered, comma-separated, the default first; "" offers every one (src/i18n/locales). */
  locales: string;
  /** More than one language: View ▸ Language… and Ctrl+K's Language… exist. */
  languageChoice: boolean;
  /** Edit together (rooms) in a production build: VITE_ENABLE_COLLAB, and share links on. */
  collab: boolean;
  /** The trackers a room announces to: VITE_COLLAB_TRACKERS, else APPROVED_TRACKERS. */
  collabTrackers: string[];
  /** The ICE servers a room's connections use: VITE_COLLAB_STUN and VITE_COLLAB_TURN, else APPROVED_STUN. */
  collabIceServers: IceServer[];
}

const on = (value: string | undefined) => /^(1|true|yes|on)$/i.test((value ?? "").trim());

/** A brand name as shown: one line, trimmed, at most BRAND_MAX characters; the default when empty. */
export function brandName(value: string | undefined): string {
  const name = (value ?? "").replace(/\s+/g, " ").trim();
  return (name.length > BRAND_MAX ? name.slice(0, BRAND_MAX).trim() : name) || DEFAULT_BRAND;
}

/**
 * VITE_LOCALES as the build reads it: language tags separated by commas or spaces, deduplicated, in order ("de, en"
 * is "de,en"). Empty: every language. A tag that isn't one throws, so a typo never ships a copy without its language.
 */
export function localeList(value: string | undefined): string {
  const tags = (value ?? "").split(/[\s,]+/).filter(Boolean);
  for (const tag of tags)
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)) throw new Error(`VITE_LOCALES: "${tag}" isn't a language tag`);
  return [...new Set(tags)].join(",");
}

const list = (value: string | undefined) => [...new Set((value ?? "").split(/[\s,]+/).filter(Boolean))];
const HOST = String.raw`[a-z0-9-]+(?:\.[a-z0-9-]+)*`;
const PORT = String.raw`(?::\d{1,5})?`;
/** A wss:// tracker (plain ws:// only on this machine), with an optional path and nothing else. */
const TRACKER = new RegExp(String.raw`^(?:wss://${HOST}|ws://(?:localhost|127\.0\.0\.1))${PORT}(?:/[\w.~/-]*)?$`, "i");
const STUN = new RegExp(String.raw`^stuns?:${HOST}${PORT}$`, "i");
const TURN = new RegExp(String.raw`^turns?:${HOST}${PORT}(?:\?transport=(?:udp|tcp))?$`, "i");

/**
 * VITE_COLLAB_TRACKERS as the build reads it, each URL in its canonical form (a lower-case scheme and host, and a
 * path: `WSS://T.example.com` is `wss://t.example.com/`), so the transport takes every one it accepts; unset, the
 * approved trackers. Anything else throws.
 */
export function trackerList(value: string | undefined): string[] {
  const urls = list(value);
  const bad = urls.filter((url) => !TRACKER.test(url));
  if (bad.length) throw new Error(`VITE_COLLAB_TRACKERS takes wss:// tracker URLs, not: ${bad.join(", ")}`);
  return urls.length ? [...new Set(urls.map((url) => new URL(url).href))] : [...APPROVED_TRACKERS];
}

/**
 * The ICE servers from VITE_COLLAB_STUN and VITE_COLLAB_TURN (with its username and credential); unset, the
 * approved STUN server and no TURN. Anything malformed throws, so a typo never ships a copy that can't connect.
 */
export function iceServerList(env: Record<string, string | undefined>): IceServer[] {
  const stunValue = (env.VITE_COLLAB_STUN ?? "").trim();
  const stun = /^none$/i.test(stunValue) ? [] : list(stunValue);
  const badStun = stun.filter((url) => !STUN.test(url));
  if (badStun.length) throw new Error(`VITE_COLLAB_STUN takes stun: URLs (or "none"), not: ${badStun.join(", ")}`);
  const turn = list(env.VITE_COLLAB_TURN);
  const badTurn = turn.filter((url) => !TURN.test(url));
  if (badTurn.length) throw new Error(`VITE_COLLAB_TURN takes turn: or turns: URLs, not: ${badTurn.join(", ")}`);
  const username = (env.VITE_COLLAB_TURN_USERNAME ?? "").trim();
  const credential = (env.VITE_COLLAB_TURN_CREDENTIAL ?? "").trim();
  if (turn.length && (!username || !credential))
    throw new Error("VITE_COLLAB_TURN needs VITE_COLLAB_TURN_USERNAME and VITE_COLLAB_TURN_CREDENTIAL");
  if (!turn.length && (username || credential))
    throw new Error("VITE_COLLAB_TURN_USERNAME and VITE_COLLAB_TURN_CREDENTIAL need VITE_COLLAB_TURN");
  return [
    ...(stunValue ? stun : APPROVED_STUN).map((urls) => ({ urls })),
    ...(turn.length ? [{ urls: turn, username, credential }] : []),
  ];
}

/**
 * The deployment variables a build sees, in Vite's order: the shell's environment first, then the .env files for
 * `mode` in `dir` (`.env.<mode>.local`, `.env.<mode>`, `.env.local`, `.env`), then `defaults` for any still
 * unset. `pnpm build:internal` passes its defaults here, so a value in `.env.local` wins over them.
 */
export function resolveDeploymentEnv(
  mode: string,
  dir: string,
  defaults: Partial<Record<DeploymentVariable, string>> = {},
): Partial<Record<DeploymentVariable, string>> {
  const env = loadEnv(mode, dir, "VITE_");
  const out: Partial<Record<DeploymentVariable, string>> = {};
  for (const key of DEPLOYMENT_VARIABLES) {
    const value = env[key] ?? defaults[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The deployment the variables describe. No variables: the public site's, but for Edit together, which is opt-in
 * (livediagrams.dev sets VITE_ENABLE_COLLAB=1 in its build settings).
 */
export function readDeployment(env: Record<string, string | undefined>): Deployment {
  return {
    shareLinks: !on(env.VITE_DISABLE_SHARE_LINKS),
    linkOpen: !on(env.VITE_DISABLE_LINK_OPEN),
    aiTools: !on(env.VITE_DISABLE_AI_TOOLS),
    onDevice: !on(env.VITE_DISABLE_ONDEVICE),
    aiPanel: !on(env.VITE_DISABLE_AI_TOOLS) || !on(env.VITE_DISABLE_ONDEVICE),
    privateByDefault: on(env.VITE_PRIVATE_BY_DEFAULT),
    brandName: brandName(env.VITE_BRAND_NAME),
    locales: localeList(env.VITE_LOCALES),
    languageChoice: !localeList(env.VITE_LOCALES) || localeList(env.VITE_LOCALES).includes(","),
    collab: on(env.VITE_ENABLE_COLLAB) && !on(env.VITE_DISABLE_SHARE_LINKS),
    collabTrackers: trackerList(env.VITE_COLLAB_TRACKERS),
    collabIceServers: iceServerList(env),
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
  locales: "__DEPLOYMENT_LOCALES__",
  languageChoice: "__DEPLOYMENT_LANGUAGE_CHOICE__",
  collab: "__DEPLOYMENT_COLLAB__",
  // Read by src/collab/room/endpoints.ts only, so they land in the room's own chunk (never at startup), and only in
  // a build that has rooms.
  collabTrackers: "__DEPLOYMENT_COLLAB_TRACKERS__",
  collabIceServers: "__DEPLOYMENT_COLLAB_ICE_SERVERS__",
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
      const env = resolveDeploymentEnv(mode, config.envDir || config.root || process.cwd());
      brand = readDeployment(env).brandName;
      return { define: deploymentDefines(env) };
    },
    configResolved(config) {
      // Vite also puts every VITE_* variable in import.meta.env, an object any module may read whole. A room's
      // endpoints (a TURN credential among them) reach the app only as the constants above, in the room's own chunk:
      // never in that object, so never at startup and never in a build without rooms.
      for (const key of COLLAB_VARIABLES) Reflect.deleteProperty(config.env, key);
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
