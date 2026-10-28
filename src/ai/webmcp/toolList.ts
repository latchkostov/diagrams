// The WebMCP tool names. Kept apart from tools.ts so the panel can list them without loading the tools' code; their
// one-line descriptions for people are ./toolHelp.ts, with the AI panel's catalog.

import { SHARE_LINKS } from "../../lib/deployment";

/** Every tool, in the order they're registered. */
const ALL_TOOLS = [
  "describe_diagram",
  "check_diagram",
  "find_stencils",
  "edit_diagram",
  "set_simulation",
  "new_diagram",
  "get_share_link",
] as const;

export type PublishedTool = (typeof ALL_TOOLS)[number];

/** A copy deployed without share links (src/lib/deployment.ts) publishes no get_share_link. */
const published = (tools: readonly PublishedTool[]): readonly PublishedTool[] =>
  SHARE_LINKS ? tools : tools.filter((t) => t !== "get_share_link");

/** The editor's tools, in the order they're registered. */
export const EDIT_TOOLS: readonly PublishedTool[] = published(ALL_TOOLS);

/** Live view (and presenting) offers reading, checking and sharing only. */
export const LIVE_TOOLS: readonly PublishedTool[] = published(["describe_diagram", "check_diagram", "get_share_link"]);

/** The tools the page publishes now. */
export const publishedTools = (live: boolean): readonly PublishedTool[] => (live ? LIVE_TOOLS : EDIT_TOOLS);
