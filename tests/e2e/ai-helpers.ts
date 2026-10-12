import type { Page } from "@playwright/test";
import { expect, STORAGE_KEYS } from "./fixtures";

// Shared by the ai-*.spec.ts files: fakes for browser APIs Playwright's Chromium doesn't have
// (WebMCP's document.modelContext, the Web Speech API), installed with page.addInitScript.

export const MOD = process.platform === "darwin" ? "Meta" : "Control";
export const SLUG = "kafka-order-pipeline";

/** The value, or a test failure saying what was missing. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}`);
  return value;
}

/** The open example's saved edits (examples autosave the diagram JSON as it is). */
export async function savedDiagram(page: Page, slug = SLUG) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.autosavePrefix + slug);
  return raw
    ? (JSON.parse(raw) as {
        nodes: { id: string; stencil: string; label: string; sublabel?: string }[];
        edges: { id: string; from: string; to: string; label?: string; kind?: string }[];
      })
    : null;
}

/** Nodes on the canvas (not their tooltips or editors). */
export const nodeCount = (page: Page) => page.getByTestId(/^node-(?!tooltip$|editor-)/).count();

/** Waits for the view to stop moving (opening or folding the dock refits the diagram; a move closes menus). */
export async function settle(page: Page, testId = "node-payments") {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await page.getByTestId(testId).boundingBox());
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [100, 150, 150, 250] },
    )
    .toBe(true);
}

/** Opens the AI panel from its rail. */
export async function openAiPanel(page: Page) {
  await page.getByTestId("ai-rail-open").click();
  // The panel is its own chunk: the dev server may still be transforming it on a busy first load.
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
}

/** Opens the AI panel and its Advanced copy-and-paste flow (closed by default, remembered). */
export async function openAdvanced(page: Page) {
  if (!(await page.getByTestId("ai-panel").isVisible())) await openAiPanel(page);
  if (!(await page.getByTestId("ai-request").isVisible())) await page.getByTestId("ai-advanced-toggle").click();
  await expect(page.getByTestId("ai-request")).toBeVisible();
}

/**
 * A fake WebMCP host, per the Oct 2026 draft: `document.modelContext.registerTool(tool, { signal })`,
 * removal by aborting the signal, duplicate names rejected. Records every call in `window.__mcp`.
 */
export function installFakeModelContext(page: Page) {
  return page.addInitScript(() => {
    type Tool = {
      name: string;
      annotations?: Record<string, boolean>;
      inputSchema?: object;
      description: string;
      execute: (input: object, client?: object) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    };
    const tools = new Map<string, Tool>();
    const log: string[] = [];
    const ctx = {
      registerTool(tool: Tool, opts?: { signal?: AbortSignal }) {
        if (tools.has(tool.name))
          return Promise.reject(new DOMException(`Tool ${tool.name} is already registered`, "InvalidStateError"));
        tools.set(tool.name, tool);
        log.push(`+${tool.name}`);
        opts?.signal?.addEventListener("abort", () => {
          if (tools.get(tool.name) !== tool) return;
          tools.delete(tool.name);
          log.push(`-${tool.name}`);
        });
        return Promise.resolve();
      },
    };
    Object.defineProperty(Document.prototype, "modelContext", { configurable: true, get: () => ctx });
    const w = window as unknown as Record<string, unknown>;
    w.__mcp = {
      names: () => [...tools.keys()],
      annotations: () => Object.fromEntries([...tools.values()].map((t) => [t.name, t.annotations ?? {}])),
      log,
      async call(name: string, input: object) {
        const tool = tools.get(name);
        if (!tool) throw new Error(`No tool ${name}`);
        const res = await tool.execute(input, {});
        return { text: res.content[0].text, isError: !!res.isError };
      },
    };
  });
}

export const toolNames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mcp: { names(): string[] } }).__mcp.names().sort());

export const callTool = (page: Page, name: string, input: object = {}) =>
  page.evaluate(
    ([n, i]) =>
      (
        window as unknown as { __mcp: { call(n: string, i: object): Promise<{ text: string; isError: boolean }> } }
      ).__mcp.call(n as string, i as object),
    [name, input] as const,
  );

/**
 * A fake SpeechRecognition (Chrome's webkit name), driven from the test through `window.__speech`:
 * `result([...])`, `error(code)`, `silence()` (the browser's own end), and `starts` / `instances`.
 * `deny` makes start() fail with "not-allowed" like a blocked microphone.
 */
export function installFakeSpeech(
  page: Page,
  opts: { deny?: boolean; onDevice?: boolean; deferredAvailability?: boolean } = {},
) {
  return page.addInitScript((o) => {
    type Ev = { resultIndex: number; results: unknown };
    const pending: ((value: string) => void)[] = [];
    const instances: FakeRecognition[] = [];
    class FakeRecognition {
      static available = o.deferredAvailability
        ? () => new Promise<string>((resolve) => pending.push(resolve))
        : o.onDevice
          ? () => Promise.resolve("available")
          : undefined;
      constructor() {
        instances.push(this);
      }
      lang = "";
      continuous = false;
      interimResults = false;
      processLocally = false;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((e: Ev) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onsoundstart: (() => void) | null = null;
      onsoundend: (() => void) | null = null;
      running = false;
      start() {
        state.starts++;
        state.current = this;
        state.config = {
          lang: this.lang,
          continuous: this.continuous,
          interimResults: this.interimResults,
          processLocally: this.processLocally,
        };
        setTimeout(() => {
          if (o.deny) {
            this.onerror?.({ error: "not-allowed" });
            this.end();
            return;
          }
          this.running = true;
          this.onstart?.();
          this.onsoundstart?.();
        }, 20);
      }
      stop() {
        state.stops++;
        this.end();
      }
      abort() {
        this.end();
      }
      ended = false;
      end() {
        if (this.ended) return;
        this.ended = true;
        this.running = false;
        setTimeout(() => this.onend?.(), 10);
      }
    }
    const state = {
      resolveAvailability() {
        pending.splice(0).forEach((resolve) => resolve("available"));
      },
      get active() {
        return instances.filter((r) => r.running).length;
      },
      starts: 0,
      stops: 0,
      current: null as FakeRecognition | null,
      config: null as unknown,
      /** [transcript, isFinal][] as the whole list of this session's results. */
      result(list: [string, boolean][]) {
        const results = list.map(([t, f]) => Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: f }));
        state.current?.onresult?.({ resultIndex: 0, results });
      },
      error(code: string) {
        state.current?.onerror?.({ error: code });
      },
      silence() {
        state.current?.end();
      },
    };
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
    w.__speech = state;
  }, opts);
}

export const speech = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => {
      const s = (window as unknown as { __speech: Record<string, (...x: unknown[]) => unknown> }).__speech;
      return s[f as string](...(a as unknown[]));
    },
    [fn, args] as const,
  );

export const speechState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __speech: { starts: number; stops: number; config: unknown; active: number } })
      .__speech;
    return { starts: s.starts, stops: s.stops, config: s.config, active: s.active };
  });
