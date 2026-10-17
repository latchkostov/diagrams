import type { Page } from "@playwright/test";
import { expect, waitForStableBox, pageLoadTimeout } from "./fixtures";

// Shared by the ai-*.spec.ts files: fakes for browser APIs Playwright's Chromium doesn't have
// (WebMCP's document.modelContext, the Web Speech API), installed with page.addInitScript.

export const MOD = "ControlOrMeta";
export const SLUG = "kafka-order-pipeline";

/** The value, or a test failure saying what was missing. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}`);
  return value;
}

export { savedDiagram } from "./fixtures";

/** Nodes on the canvas (not their tooltips or editors). */
export const nodeCount = (page: Page) => page.getByTestId(/^node-(?!tooltip$|editor-)/).count();

/** Waits for the view to stop moving (opening or folding the dock refits the diagram; a move closes menus). */
export function settle(page: Page, testId = "node-payments") {
  return waitForStableBox(page.getByTestId(testId));
}

/** Opens the AI panel from its rail. */
export async function openAiPanel(page: Page) {
  await page.getByTestId("ai-rail-open").click();
  // The panel is its own chunk: the dev server may still be transforming it on a busy first load.
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
}

/** Opens the AI panel and its Advanced copy-and-paste flow (closed by default, remembered). */
export async function openAdvanced(page: Page) {
  // A remembered open dock restores its lazy panel after the canvas. Until then there is no rail to click.
  await expect(page.getByTestId("ai-panel").or(page.getByTestId("ai-rail-open"))).toBeVisible({
    timeout: pageLoadTimeout(),
  });
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
 * `holdStarts()` keeps each later session's start event back until `releaseStart()` (results can come first).
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
        const begin = () => {
          if (o.deny) {
            this.onerror?.({ error: "not-allowed" });
            this.end();
            return;
          }
          this.running = true;
          this.onstart?.();
          this.onsoundstart?.();
        };
        if (state.holding) state.heldStart = begin;
        else setTimeout(begin, 20);
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
      holding: false,
      heldStart: null as (() => void) | null,
      holdStarts() {
        state.holding = true;
      },
      releaseStart() {
        state.holding = false;
        const begin = state.heldStart;
        state.heldStart = null;
        begin?.();
      },
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

export interface FakeModelOptions {
  availability?: "unavailable" | "downloadable" | "downloading" | "available";
  /**
   * Replies in order (JSON strings). "hang" waits until the request is cancelled; "hold:<json>" waits
   * for `releaseModel(page)`, then answers <json> (unless cancelled first).
   */
  replies?: string[];
  /** create() waits for `releaseModel(page, "create")`, like a slow first session. */
  deferCreate?: boolean;
  /** A download reports 0, 0.5, 1 this many ms apart. */
  downloadStepMs?: number;
  /** Sessions without clone(), as an older Prompt API had. */
  noClone?: boolean;
}

/**
 * A fake Prompt API (`LanguageModel`, Chrome's built-in model): availability as given, a download with
 * progress through `monitor`, and canned replies. Records prompts in `window.__lm`.
 */
export function installFakeLanguageModel(page: Page, opts: FakeModelOptions = {}) {
  return page.addInitScript((o) => {
    const state = {
      availability: o.availability ?? "available",
      replies: [...(o.replies ?? [])],
      prompts: [] as string[],
      /** The session each prompt went to (by number, from 1 in creation order), and the sessions destroyed. */
      promptSessions: [] as number[],
      destroyedSessions: [] as number[],
      sessions: 0,
      creates: 0,
      monitored: false,
      constraints: 0,
      destroyed: 0,
      aborted: 0,
      held: [] as (() => void)[],
      createHeld: [] as (() => void)[],
      release(which: "reply" | "create" = "reply") {
        (which === "create" ? state.createHeld : state.held).splice(0).forEach((go) => go());
      },
    };
    type Listener = (e: { loaded: number }) => void;
    const session = (id = ++state.sessions): object => ({
      async prompt(input: string, options?: { signal?: AbortSignal; responseConstraint?: object }) {
        // Chrome refuses a destroyed session's prompt; so does the fake, so a test can't miss one.
        if (state.destroyedSessions.includes(id))
          throw new DOMException("The session was destroyed.", "InvalidStateError");
        state.prompts.push(input);
        state.promptSessions.push(id);
        if (options?.responseConstraint) state.constraints++;
        let reply = state.replies.shift() ?? '{"summary":"","ops":[]}';
        if (reply.startsWith("hold:")) {
          const body = reply.slice(5);
          await new Promise<void>((resolve, reject) => {
            const fail = () => {
              state.aborted++;
              reject(new DOMException("The request was aborted.", "AbortError"));
            };
            if (options?.signal?.aborted) return fail();
            options?.signal?.addEventListener("abort", fail);
            state.held.push(resolve);
          });
          reply = body;
        }
        if (reply === "hang")
          return new Promise<string>((_, reject) => {
            const fail = () => {
              state.aborted++;
              reject(new DOMException("The request was aborted.", "AbortError"));
            };
            if (options?.signal?.aborted) fail();
            options?.signal?.addEventListener("abort", fail);
          });
        await new Promise((r) => setTimeout(r, 30));
        return reply;
      },
      ...(o.noClone
        ? {}
        : {
            async clone() {
              return session();
            },
          }),
      destroy() {
        state.destroyed++;
        state.destroyedSessions.push(id);
      },
      contextUsage: 0,
      contextWindow: 9216,
    });
    const LanguageModel = {
      async availability() {
        return state.availability;
      },
      async create(options?: { monitor?: (m: { addEventListener(t: string, l: Listener): void }) => void }) {
        state.creates++;
        if (o.deferCreate) await new Promise<void>((resolve) => state.createHeld.push(resolve));
        const listeners: Listener[] = [];
        options?.monitor?.({
          addEventListener: (_t: string, l: Listener) => {
            state.monitored = true;
            listeners.push(l);
          },
        });
        if (state.availability !== "available") {
          for (const loaded of [0, 0.5, 1]) {
            listeners.forEach((l) => l({ loaded }));
            await new Promise((r) => setTimeout(r, o.downloadStepMs ?? 150));
          }
          state.availability = "available";
        }
        return session();
      },
    };
    (window as unknown as Record<string, unknown>).LanguageModel = LanguageModel;
    (window as unknown as Record<string, unknown>).__lm = state;
  }, opts);
}

/** Lets held replies (or a deferred create()) of the fake model go on. */
export const releaseModel = (page: Page, which: "reply" | "create" = "reply") =>
  page.evaluate((w) => (window as unknown as { __lm: { release(w: string): void } }).__lm.release(w), which);

/** The fake model's record: prompts sent, sessions created, and so on. */
export const fakeModel = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __lm: Record<string, unknown> }).__lm;
    // The held callbacks aren't data.
    return JSON.parse(JSON.stringify(s, (k, v: unknown) => (k === "held" || k === "createHeld" ? undefined : v))) as {
      availability: string;
      prompts: string[];
      promptSessions: number[];
      destroyedSessions: number[];
      creates: number;
      monitored: boolean;
      constraints: number;
      destroyed: number;
      aborted: number;
    };
  });

/** A model reply in the on-device op format. */
export const modelReply = (summary: string, ops: object[]) => JSON.stringify({ summary, ops });
