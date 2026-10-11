// The one place that knows WebMCP's shape (draft CG report, Oct 2026): feature detection, the
// return format and registration. The API has changed twice already, so keep it all here.
//
//   document.modelContext.registerTool({ name, title, description, inputSchema, annotations, execute },
//                                      { signal })   // abort the signal to unregister
//
// `navigator.modelContext` is the deprecated alias (Chrome 150 logs a warning); it's read only when
// `document.modelContext` is missing.

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

/** What `execute` hands back to the agent. MCP-style content; switch the format here only. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  annotations?: ToolAnnotations;
  execute: (input: Record<string, unknown>, client?: { signal?: AbortSignal }) => Promise<ToolResult>;
}

export interface ModelContextLike {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<unknown> | unknown;
}

/** Our tool definitions, before the adapter wraps `run` into `execute`. */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: ToolAnnotations;
  run(input: Record<string, unknown>, signal?: AbortSignal): unknown;
}

/** True when the page can offer tools. Doesn't touch the deprecated alias unless it has to. */
export function hasModelContext(doc: unknown = globalThis.document, nav: unknown = globalThis.navigator): boolean {
  return getModelContext(doc, nav) !== undefined;
}

export function getModelContext(
  doc: unknown = globalThis.document,
  nav: unknown = globalThis.navigator,
): ModelContextLike | undefined {
  const isCtx = (v: unknown): v is ModelContextLike =>
    !!v && typeof (v as ModelContextLike).registerTool === "function";
  const d = doc && "modelContext" in (doc as object) ? (doc as { modelContext?: unknown }).modelContext : undefined;
  if (isCtx(d)) return d;
  const n = nav && "modelContext" in (nav as object) ? (nav as { modelContext?: unknown }).modelContext : undefined;
  return isCtx(n) ? n : undefined;
}

/** Text for the agent: strings as they are (describe output), anything else as JSON. */
export function toToolResult(result: unknown): ToolResult {
  const text = typeof result === "string" ? result : JSON.stringify(result ?? null);
  const failed = !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
  return { content: [{ type: "text", text }], ...(failed ? { isError: true } : {}) };
}

/** A thrown error becomes a result the model can read and retry from, never an exception. */
export function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return toToolResult({ ok: false, error: message, hint: "Check the input against the tool's schema and try again." });
}

/** Wraps one definition for registerTool: the shared return format and error handling. */
export function toModelContextTool(def: ToolDef): ModelContextTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    async execute(input, client) {
      try {
        if (client?.signal?.aborted) return errorResult(new Error("The call was cancelled."));
        return toToolResult(await def.run(input && typeof input === "object" ? input : {}, client?.signal));
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

const isDuplicate = (err: unknown) =>
  err instanceof Error &&
  (err.name === "InvalidStateError" || /already|duplicate|exists|registered/i.test(err.message));

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Registers every tool under `signal`; aborting it unregisters them. A name still held by a just-
 * aborted registration (React StrictMode mounts effects twice) is retried briefly. Never throws:
 * returns the names that registered.
 */
export async function registerTools(
  ctx: ModelContextLike,
  defs: readonly ToolDef[],
  signal: AbortSignal,
): Promise<string[]> {
  const done: string[] = [];
  for (const def of defs) {
    for (let attempt = 0; attempt < 4 && !signal.aborted; attempt++) {
      try {
        await ctx.registerTool(toModelContextTool(def), { signal });
        done.push(def.name);
        break;
      } catch (err) {
        if (!isDuplicate(err) || attempt === 3) {
          if (!signal.aborted) console.warn(`[webmcp] couldn't register ${def.name}:`, err);
          break;
        }
        await tick(25 * (attempt + 1));
      }
    }
    if (signal.aborted) break;
  }
  return done;
}
