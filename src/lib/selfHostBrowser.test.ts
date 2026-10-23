import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { withSmokeBrowser } from "../../scripts/self-host-browser";

const { connection } = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock("../../scripts/isolated-smoke-browser", () => ({ withIsolatedBrowser: connection }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("prints boot evidence before closing pages, without replacing the original failure", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const page = Object.assign(new EventEmitter(), {
    url: () => "http://container/tools/a/deep/route",
    evaluate: vi.fn(async () => '<head><base href="/tools/"></head>'),
  });
  const context = Object.assign(new EventEmitter(), {
    addInitScript: vi.fn(async (script: () => void) => script()),
    pages: () => [page],
  });
  const browser = {
    newContext: async () => context,
    contexts: () => [context],
    close: vi.fn(async () => {
      expect(output.mock.calls.flat().join("\n")).toContain('<head><base href="/tools/"></head>');
    }),
  };
  connection.mockImplementation(async (check: (value: unknown) => Promise<void>) => {
    try {
      await check(browser);
    } finally {
      await browser.close();
    }
  });
  const addEventListener = vi.fn();
  vi.stubGlobal("document", { addEventListener });
  const failure = new Error("brand never mounted");
  await expect(
    withSmokeBrowser(async (newContext) => {
      await newContext();
      context.emit("page", page);
      page.emit("console", { type: () => "error", text: () => "Failed module", location: () => ({ lineNumber: 1 }) });
      page.emit("pageerror", new Error("Module evaluation failed"));
      page.emit("requestfailed", {
        method: () => "GET",
        url: () => "http://container/blocked.js",
        failure: () => ({ errorText: "net::ERR_BLOCKED_BY_CSP" }),
      });
      for (const status of [200, 404])
        page.emit("response", {
          status: () => status,
          request: () => ({ resourceType: () => "script" }),
          url: () => `http://container/chunk-${status}.js`,
        });
      expect(addEventListener.mock.calls[0][0]).toBe("securitypolicyviolation");
      const violation = addEventListener.mock.calls[0][1] as (event: object) => void;
      violation({
        effectiveDirective: "script-src-elem",
        blockedURI: "http://container/blocked.js",
        sourceFile: page.url(),
        lineNumber: 2,
        originalPolicy: "script-src 'self'",
      });
      throw failure;
    }),
  ).rejects.toBe(failure);
  const log = output.mock.calls.flat().join("\n");
  for (const evidence of [
    "Failed module",
    "Module evaluation failed",
    "net::ERR_BLOCKED_BY_CSP",
    "200 script http://container/chunk-200.js",
    "404 script http://container/chunk-404.js",
    "script-src-elem",
    "script-src 'self'",
    page.url(),
  ])
    expect(log).toContain(evidence);
  expect(browser.close).toHaveBeenCalledOnce();
});

it("retains the assertion failure when a page head cannot be read", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const browser = {
    contexts: () => [
      {
        pages: () => [
          {
            url: () => "about:blank",
            evaluate: async () => {
              throw new Error("Page crashed");
            },
          },
        ],
      },
    ],
    close: vi.fn(),
  };
  connection.mockImplementation(async (check: (value: unknown) => Promise<void>) => {
    try {
      await check(browser);
    } finally {
      await browser.close();
    }
  });
  const failure = new Error("boot assertion");
  await expect(
    withSmokeBrowser(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(output.mock.calls.flat().join("\n")).toContain("Page crashed");
  expect(browser.close).toHaveBeenCalledOnce();
});
