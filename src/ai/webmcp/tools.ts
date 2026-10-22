// The WebMCP tools: names, schemas and descriptions come from the core (src/ai/schemas.ts); this file
// only connects them to the open editor. Every call that changes the diagram is one undo step.

import type { EditorApi } from "../../editor/types";
import type { DiagramFile, StencilCategory } from "../../model/types";
import type { CheckRuleId } from "../../model/checks";
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
import { PRIVATE_MESSAGE } from "../privacy";
import type { ToolDef } from "./adapter";
import { EDIT_TOOLS } from "./toolList";
import { choicesFrom, type StencilChoice } from "../ui/apply";
import { turnId } from "../ui/thread";
import { scenarioPlanner } from "../../lib/scenarioPlanner";
import { awaitRequestChecks, requestChecksNeeded } from "../../lib/requestCheckCache";
import type { Finding } from "../../checks/types";

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
  /** The open document's identity, for calls that wait: the same editor can open another diagram. */
  documentId?(): string | undefined;
  /** Shows the change (toast with Undo, a brief highlight) and records it as a turn in the AI panel. */
  onApplied(change: AgentChange): void;
  newDiagram(opts: { title?: string; direction?: "LR" | "TB" }): Promise<EditorApi | null>;
  shareLink(diagram: DiagramFile): Promise<{ url: string; length: number; warning?: string }>;
}

const TITLES: Record<ToolName, string> = {
  describe_diagram: "Describe the diagram",
  check_diagram: "Check the diagram",
  find_stencils: "Find stencils",
  edit_diagram: "Edit the diagram",
  set_simulation: "Set a simulation",
  new_diagram: "New diagram",
  get_share_link: "Get a share link",
};

// The names live in toolList.ts (the AI panel lists them without loading this file).
export { EDIT_TOOLS, LIVE_TOOLS } from "./toolList";

/** Chrome's guidance: keep tool output around 1.5K characters. Long result lists are summarised. */
const OUTPUT_BUDGET = 1500;

function needEditor(host: WebMcpHost): EditorApi {
  if (host.canUseAi?.() === false) throw new Error(PRIVATE_MESSAGE);
  const editor = host.getEditor();
  if (!editor) throw new Error("The diagram is still loading. Try again in a moment.");
  return editor;
}

const CANCELLED = "The call was cancelled.";

/**
 * A guard for a call that waits: returns a check that throws, saying nothing about the diagram, unless the same
 * diagram is still open in the same editor and AI tools may still read it (not made Private or local-only, and the
 * copy still allows them).
 */
function sameDocument(host: WebMcpHost): () => void {
  const editor = needEditor(host);
  const doc = host.documentId?.();
  return () => {
    if (host.canUseAi?.() === false) throw new Error(PRIVATE_MESSAGE);
    if (host.getEditor() !== editor || host.documentId?.() !== doc)
      throw new Error("Another diagram was opened while its simulations played. Call check_diagram again.");
  };
}

/**
 * Scenario sizing plays simulations, so in the editor it runs in the checks worker (memoized there): wait for its
 * result for `diagram`, then describe or check on this thread without running one. Only when the reply can use it
 * (`wanted`); a failed plan leaves sizing out; cancelling the call stops the wait.
 */
async function sizingReady(
  host: WebMcpHost,
  diagram: DiagramFile,
  wanted: boolean,
  signal: AbortSignal | undefined,
): Promise<void> {
  const plan = wanted && diagram.simulations?.length ? scenarioPlanner()?.(diagram) : undefined;
  if (!plan) return;
  const still = sameDocument(host);
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error(CANCELLED));
    const abort = () => reject(new Error(CANCELLED));
    signal?.addEventListener("abort", abort, { once: true });
    void plan
      .catch(() => undefined)
      .then(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      });
  });
  if (signal?.aborted) throw new Error(CANCELLED);
  still();
}
/**
 * This diagram's request findings, from the checks worker (shared with background checks). Cancelling the call stops
 * the wait, not the shared work. Whatever happens, nothing goes back unless the same diagram is still open and AI tools
 * may still read it; a failure is reported in words that say nothing about the diagram.
 */
async function requestChecksReady(
  host: WebMcpHost,
  diagram: DiagramFile,
  signal: AbortSignal | undefined,
): Promise<Finding[]> {
  const still = sameDocument(host);
  if (signal?.aborted) throw new Error(CANCELLED);
  const checks = awaitRequestChecks(diagram);
  let findings: Finding[] | undefined;
  let failure: unknown;
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error(CANCELLED));
    signal?.addEventListener("abort", abort, { once: true });
    void checks
      .then(
        (found) => void (findings = found),
        (err: unknown) => void (failure = err ?? new Error("failed")),
      )
      .finally(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      });
  });
  if (signal?.aborted) throw new Error(CANCELLED);
  still();
  if (!findings) throw new Error(REQUEST_CHECKS_FAILED, { cause: failure });
  return findings;
}
const REQUEST_CHECKS_FAILED = "The waiting-call checks couldn't finish. Call check_diagram again.";

/** Whether a check reply includes the capacity rule, the one that reads scenario sizing. */
const capacityRuns = (diagram: DiagramFile, rules: readonly CheckRuleId[] | undefined) =>
  (!rules || rules.includes("capacity")) && !diagram.checks?.off?.includes("capacity");

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
    async describe_diagram(input, signal) {
      checkSchema(input, toolSchemas.describe_diagram);
      const diagram = needEditor(host).getDiagram();
      // The description reads sizing only where it analyses the graph (up to 200 nodes and 500 connections).
      await sizingReady(host, diagram, diagram.nodes.length <= 200 && diagram.edges.length <= 500, signal);
      return describeDiagram(needEditor(host).getDiagram(), input as DescribeOptions);
    },

    async check_diagram(input, signal) {
      checkSchema(input, toolSchemas.check_diagram);
      needEditor(host);
      const { rules, include, simulations } = input as {
        rules?: CheckRuleId[];
        include?: "warnings" | "all";
        simulations?: boolean;
      };
      // The checks are a lazy chunk: loaded on the first call, never at startup.
      const { runChecks, agentReport, onlyRules } = await import("../../checks");
      // Read the diagram after the load: it may have become private (or another one opened) meanwhile.
      const diagram = needEditor(host).getDiagram();
      const playing = simulations && !!diagram.simulations?.length;
      // Request checks replay simulations off-thread: wait for this diagram's (a miss is never a clean result), then
      // hand them to runChecks, so a later recheck or a full cache can't change what this call reads. With
      // simulations every check runs (their counts are classified against all of them).
      const requests = requestChecksNeeded(diagram, playing ? undefined : rules)
        ? await requestChecksReady(host, diagram, signal)
        : undefined;
      await sizingReady(host, diagram, capacityRuns(diagram, playing ? undefined : rules), signal);
      if (!playing) return agentReport(runChecks(diagram, { ...(rules ? { rules } : {}), requests }), include);
      // Run simulations, as the Checks card does: in a worker, bounded (a minute of each, about 15 s in all). It takes
      // seconds, so everything checked at the start is checked again before anything about the diagram goes back.
      const still = sameDocument(host);
      const { playSimulations, withEvidence } = await import("../../checks/evidenceClient");
      if (signal?.aborted) throw new Error(CANCELLED);
      still();
      const run = playSimulations(diagram, () => {});
      const cancel = () => run.cancel();
      signal?.addEventListener("abort", cancel);
      let evidence;
      try {
        evidence = await run.done;
      } catch (err) {
        if (signal?.aborted) throw new Error(CANCELLED, { cause: err });
        throw err;
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
      if (signal?.aborted) throw new Error(CANCELLED);
      still();
      // Counts are classified against every check, then the reply keeps the rules asked for.
      const { result, planned } = withEvidence(runChecks(diagram, { requests }), evidence, diagram.checks);
      return agentReport(onlyRules(result, rules), include, { evidence, planned });
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
      const diff = editor.applyDiagram(result.diagram, { merge: historyKey });
      // Already as asked: no undo step, so no turn (a retry can't crowd real changes out of the thread).
      if (!diff.hasChanges) return { ok: true, summary: "No change: the diagram already matched.", changed: false };
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
      const diff = editor.applyDiagram({ ...before, simulations }, { merge: historyKey });
      if (diff.hasChanges)
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
        ...(diff.hasChanges ? { undo: "One undo step reverts this call." } : { changed: false }),
        play: "The user plays it in live view (L), or from the command palette.",
      };
    },

    async new_diagram(input) {
      checkSchema(input, toolSchemas.new_diagram);
      const { title, direction } = input as { title?: string; direction?: "LR" | "TB" };
      if (host.canUseAi?.() === false) throw new Error(PRIVATE_MESSAGE);
      const editor = await host.newDiagram({ title, direction });
      if (!editor) throw new Error("The new diagram didn't open. Try again.");
      if (host.canUseAi?.() === false) throw new Error(PRIVATE_MESSAGE);
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
