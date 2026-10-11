// The WebMCP tools: names, schemas and descriptions come from the core (src/ai/schemas.ts); this file
// only connects them to the open editor. Every call that changes the diagram is one undo step.

import type { EditorApi } from "../../editor/types";
import type { DiagramFile, StencilCategory } from "../../model/types";
import {
  applyOps,
  buildSimulation,
  describeDiagram,
  findStencils,
  toolDescriptions,
  toolSchemas,
  toolAnnotations,
  type DescribeOptions,
  type DiagramOp,
  type LayoutMode,
  type SimulationSpec,
} from "../index";
import { checkSchema } from "../validation";
import { diagramDiff } from "../../model/diagramDiff";
import { LOCAL_ONLY_MESSAGE } from "../privacy";
import type { ToolDef } from "./adapter";
import { choicesFrom, type StencilChoice } from "../ui/apply";
import { turnId } from "../ui/thread";

export type ToolName = keyof typeof toolSchemas;

/** One tool call that changed the diagram, as the AI panel records it. */
export interface AgentChange {
  tool: "edit_diagram" | "set_simulation" | "new_diagram";
  /** The agent's own note (the input's `summary`), when it gave one. */
  note?: string;
  /** What changed, in words ("+2 nodes, +1 connection"). */
  summary: string;
  /** Ids added or changed (highlighted while the turn is hovered). */
  changed: string[];
  editor: EditorApi;
  /** The history step the call made (its applyDiagram tag); none for a new diagram. */
  historyKey?: string;
  choices?: StencilChoice[];
  warnings?: string[];
}

const noteOf = (input: Record<string, unknown>) =>
  typeof input.summary === "string" && input.summary.trim() ? input.summary.trim().slice(0, 200) : undefined;

/** What the tools need from the app; read at call time, so a remounted canvas is picked up. */
export interface WebMcpHost {
  getEditor(): EditorApi | null;
  /** Rechecked per call, including callbacks retained across document switches. */
  canUseAi?(): boolean;
  /** Shows the change (toast with Undo, a brief highlight) and records it as a turn in the AI panel. */
  onApplied(change: AgentChange): void;
  newDiagram(opts: { title?: string; direction?: "LR" | "TB" }): Promise<EditorApi | null>;
  shareLink(diagram: DiagramFile): Promise<{ url: string; length: number; warning?: string }>;
}

const TITLES: Record<ToolName, string> = {
  describe_diagram: "Describe the diagram",
  find_stencils: "Find stencils",
  edit_diagram: "Edit the diagram",
  set_simulation: "Set a simulation",
  new_diagram: "New diagram",
  get_share_link: "Get a share link",
};

/** Live view (and presenting) offers reading and sharing only. */
export const LIVE_TOOLS: readonly ToolName[] = ["describe_diagram", "get_share_link"];
export const EDIT_TOOLS: readonly ToolName[] = [
  "describe_diagram",
  "find_stencils",
  "edit_diagram",
  "set_simulation",
  "new_diagram",
  "get_share_link",
];

/** Chrome's guidance: keep tool output around 1.5K characters. Long result lists are summarised. */
const OUTPUT_BUDGET = 1500;

function needEditor(host: WebMcpHost): EditorApi {
  if (host.canUseAi?.() === false) throw new Error(LOCAL_ONLY_MESSAGE);
  const editor = host.getEditor();
  if (!editor) throw new Error("The diagram is still loading. Try again in a moment.");
  return editor;
}

function compact<T extends { results?: unknown[] }>(result: T): T {
  if (JSON.stringify(result).length <= OUTPUT_BUDGET || !result.results) return result;
  const results = [...result.results];
  while (results.length > 3 && JSON.stringify({ ...result, results }).length > OUTPUT_BUDGET) results.pop();
  return {
    ...result,
    results,
    more: `${result.results.length - results.length} more results omitted; call describe_diagram for the ids.`,
  };
}

export function buildTools(host: WebMcpHost, names: readonly ToolName[] = EDIT_TOOLS): ToolDef[] {
  const run: Record<ToolName, ToolDef["run"]> = {
    describe_diagram(input) {
      checkSchema(input, toolSchemas.describe_diagram);
      return describeDiagram(needEditor(host).getDiagram(), input as DescribeOptions);
    },

    find_stencils(input) {
      checkSchema(input, toolSchemas.find_stencils);
      const { query, category, limit } = input as { query: string; category?: StencilCategory; limit?: number };
      return findStencils(query, { category, limit });
    },

    edit_diagram(input) {
      const editor = needEditor(host);
      const { ops, layout, dryRun } = input as { ops: DiagramOp[]; layout?: LayoutMode; dryRun?: boolean };
      const before = editor.getDiagram();
      const result = applyOps(before, ops ?? [], { ...(layout ? { layout } : {}), ...(dryRun ? { dryRun } : {}) });
      if (!result.ok) {
        const e = result.errors[0] ?? { i: -1, error: "The ops couldn't be applied." };
        return {
          ok: false,
          ...e,
          applied: false,
          hint: e.hint ?? "Nothing was applied. Fix this op and send the whole batch again.",
        };
      }
      const summary = result.summary;
      if (dryRun)
        return compact({ ok: true, dryRun: true, summary, results: result.results, warnings: result.warnings });
      // Its own history tag: the AI panel offers Undo this change while this step is next.
      const historyKey = `ai:${turnId()}`;
      editor.applyDiagram(result.diagram, { merge: historyKey });
      const diff = diagramDiff(before, result.diagram);
      const choices = choicesFrom(result.results, ops ?? []).map((c) => ({
        ...c,
        node: result.diagram.nodes.find((n) => n.id === c.nodeId),
      }));
      host.onApplied({
        tool: "edit_diagram",
        note: noteOf(input),
        summary,
        changed: [...diff.added.ids, ...diff.updated.ids],
        editor,
        historyKey,
        ...(choices.length ? { choices } : {}),
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
      });
      return compact({
        ok: true,
        summary,
        undo: "One undo step reverts this call.",
        results: result.results,
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
      });
    },

    set_simulation(input) {
      const editor = needEditor(host);
      const before = editor.getDiagram();
      const sim = buildSimulation(before, input as unknown as SimulationSpec);
      const sims = before.simulations ?? [];
      const replaced = sims.some((s) => s.id === sim.id);
      const simulations = replaced ? sims.map((s) => (s.id === sim.id ? sim : s)) : [...sims, sim];
      const historyKey = `ai:${turnId()}`;
      editor.applyDiagram({ ...before, simulations }, { merge: historyKey });
      host.onApplied({
        tool: "set_simulation",
        note: noteOf(input),
        summary: `${replaced ? "Updated" : "Added"} simulation “${sim.title}”`,
        changed: [...new Set(sim.traffic.map((t) => t.node))],
        editor,
        historyKey,
      });
      return {
        ok: true,
        id: sim.id,
        title: sim.title,
        summary: `${replaced ? "Replaced" : "Added"} simulation ${JSON.stringify(sim.title)}: ${sim.traffic.length} traffic, ${sim.timeline?.length ?? 0} events, ${sim.expectations?.length ?? 0} expectations.`,
        undo: "One undo step reverts this call.",
        play: "The user plays it in live view (L), or from the command palette.",
      };
    },

    async new_diagram(input) {
      checkSchema(input, toolSchemas.new_diagram);
      const { title, direction } = input as { title?: string; direction?: "LR" | "TB" };
      const editor = await host.newDiagram({ title, direction });
      if (!editor) throw new Error("The new diagram didn't open. Try again.");
      if (host.canUseAi?.() === false) throw new Error(LOCAL_ONLY_MESSAGE);
      const d = editor.getDiagram();
      host.onApplied({
        tool: "new_diagram",
        note: noteOf(input),
        summary: `Started “${d.title}”`,
        changed: [],
        editor,
      });
      return {
        ok: true,
        title: d.title,
        direction: d.direction ?? "LR",
        note: "The previous diagram stays in Your diagrams.",
      };
    },

    async get_share_link() {
      return host.shareLink(needEditor(host).getDiagram());
    },
  };

  return names.map((name) => ({
    name,
    title: TITLES[name],
    description: toolDescriptions[name],
    inputSchema: toolSchemas[name],
    annotations: toolAnnotations[name],
    run: run[name],
  }));
}
