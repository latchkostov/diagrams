import { msg } from "../../i18n";
import type { PublishedTool } from "./toolList";

// The AI panel's "What agents can do here": one line per tool, in the AI catalog the panel waits for.

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
