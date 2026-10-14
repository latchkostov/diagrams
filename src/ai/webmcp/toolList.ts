import { msg } from "../../i18n";
// The WebMCP tool names and their one-line descriptions for people (the AI panel's "What agents can do
// here"). Kept apart from tools.ts so the panel can list them without loading the tools' code.

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

/** What each tool lets an agent do, in a line, for the person. */
export const TOOL_HELP: Record<PublishedTool, () => string> = {
  describe_diagram: msg("ai.tool.describeDiagram"),
  check_diagram: msg("ai.tool.checkDiagram"),
  find_stencils: msg("ai.tool.findStencils"),
  edit_diagram: msg("ai.tool.editDiagram"),
  set_simulation: msg("ai.tool.setSimulation"),
  new_diagram: msg("ai.tool.newDiagram"),
  get_share_link: msg("ai.tool.getShareLink"),
};
