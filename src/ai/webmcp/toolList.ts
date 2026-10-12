// The WebMCP tool names and their one-line descriptions for people (the AI panel's "What agents can do
// here"). Kept apart from tools.ts so the panel can list them without loading the tools' code.

/** Every tool, in the order they're registered. */
export const EDIT_TOOLS = [
  "describe_diagram",
  "find_stencils",
  "edit_diagram",
  "set_simulation",
  "new_diagram",
  "get_share_link",
] as const;

export type PublishedTool = (typeof EDIT_TOOLS)[number];

/** Live view (and presenting) offers reading and sharing only. */
export const LIVE_TOOLS: readonly PublishedTool[] = ["describe_diagram", "get_share_link"];

/** The tools the page publishes now. */
export const publishedTools = (live: boolean): readonly PublishedTool[] => (live ? LIVE_TOOLS : EDIT_TOOLS);

/** What each tool lets an agent do, in a line, for the person. */
export const TOOL_HELP: Record<PublishedTool, string> = {
  describe_diagram: "Reads the diagram: its nodes, connections, boundaries and simulations.",
  find_stencils: "Searches the stencils for the right icon.",
  edit_diagram: "Adds, connects, changes or removes things, as one undo step.",
  set_simulation: "Adds or replaces a simulation: traffic, failures and expectations.",
  new_diagram: "Starts a new diagram; this one stays in Your diagrams.",
  get_share_link: "Makes a link that opens this diagram.",
};
