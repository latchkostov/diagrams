// How this copy of the app is deployed: the public site, or a company's own copy behind its sign-in
// (docs/SELF-HOSTING.md). The one place the app reads the self-hosting switches; the privacy gates in
// ./localOnly.ts and the menus that offer links or AI ask here, never the environment.
//
// Every value is fixed at build time. scripts/deployment-env.ts reads the VITE_* variables named below and defines
// each `__DEPLOYMENT_*__` constant as a literal (`true`, `false`, a string), so these are plain constants: the
// bundler inlines them where they're used and drops the code a switch turns off (deployment.build.test.ts checks).

declare const __DEPLOYMENT_SHARE_LINKS__: boolean;
declare const __DEPLOYMENT_LINK_OPEN__: boolean;
declare const __DEPLOYMENT_AI_TOOLS__: boolean;
declare const __DEPLOYMENT_ON_DEVICE__: boolean;
declare const __DEPLOYMENT_AI_PANEL__: boolean;
declare const __DEPLOYMENT_PRIVATE_BY_DEFAULT__: boolean;
declare const __DEPLOYMENT_BRAND_NAME__: string;
declare const __DEPLOYMENT_LOCALES__: string;
declare const __DEPLOYMENT_LANGUAGE_CHOICE__: boolean;

/**
 * Share links, links with a password and embed codes made here (VITE_DISABLE_SHARE_LINKS=1 turns them off: the
 * menu rows, the palette's commands and the agents' get_share_link are gone, not just disabled).
 */
export const SHARE_LINKS = __DEPLOYMENT_SHARE_LINKS__;

/**
 * Opening a link someone sent (`#d=`, `#e=`, and an embed carrying one). On even when links can't be made
 * here; VITE_DISABLE_LINK_OPEN=1 turns it off.
 */
export const LINK_OPEN = __DEPLOYMENT_LINK_OPEN__;

/**
 * The AI that reads a diagram outside the app: the page's tools for agents (WebMCP), Copy for AI, Advanced's
 * copied prompts and Build with AI. VITE_DISABLE_AI_TOOLS=1 turns them off.
 */
export const AI_TOOLS = __DEPLOYMENT_AI_TOOLS__;

/** Chrome's built-in model, which runs on the device. VITE_DISABLE_ONDEVICE=1 turns it off. */
export const ON_DEVICE = __DEPLOYMENT_ON_DEVICE__;

/** The AI panel (and its rail, Ctrl+I) exists while anything in it does: AI tools or the on-device model. */
export const AI_PANEL = __DEPLOYMENT_AI_PANEL__;

/** "New diagrams are private" starts on (VITE_PRIVATE_BY_DEFAULT=1); people can still turn it off. */
export const PRIVATE_BY_DEFAULT = __DEPLOYMENT_PRIVATE_BY_DEFAULT__;

/** The product's name in the top bar and the page title: VITE_BRAND_NAME, e.g. "Acme Diagrams (internal)". */
export const BRAND_NAME = __DEPLOYMENT_BRAND_NAME__;

/**
 * The languages this copy offers (VITE_LOCALES, e.g. "de,en"), comma-separated, its default first; "" for every
 * language (src/i18n/locales). One language is that language for everyone, with no Language choice.
 */
export const LOCALES = __DEPLOYMENT_LOCALES__;

/** More than one language: the View menu's Language… and Ctrl+K's. */
export const LANGUAGE_CHOICE = __DEPLOYMENT_LANGUAGE_CHOICE__;

/** Why a link can't be made, when this copy makes none. */
export const LINKS_OFF_MESSAGE = "Share links are turned off here. Export Interactive HTML instead.";
/** Why a link someone sent didn't open, when this copy opens none. */
export const LINK_OPEN_OFF_MESSAGE = "Opening shared links is turned off here. Ask for the diagram file instead.";
