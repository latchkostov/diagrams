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
export const TOOL_HELP: Record<PublishedTool, string> = {
  describe_diagram: "Reads the diagram: its nodes, connections, boundaries and simulations.",
  check_diagram: "Finds likely design problems, like lost messages or overload, and their fixes.",
  find_stencils: "Searches the stencils for the right icon.",
  edit_diagram: "Adds, connects, changes or removes things, as one undo step.",
  set_simulation: "Adds or replaces a simulation: traffic, failures and expectations.",
  new_diagram: "Starts a new diagram; this one stays in Your diagrams.",
  get_share_link: "Makes a link that opens this diagram.",
};
