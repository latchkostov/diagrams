import type { BrowserContext } from "@playwright/test";
import { withIsolatedBrowser } from "./isolated-smoke-browser";
import { duringStartup, type StartupProbe } from "./smoke-startup";

/** Keep boot evidence in CI stdout, before pages and their containers are disposed. */
export async function withSmokeBrowser(
  check: (newContext: () => Promise<BrowserContext>) => Promise<void>,
  startup?: StartupProbe,
): Promise<void> {
  await withIsolatedBrowser(async (browser) => {
    const requests: string[] = [];
    const newContext = async () => {
      const context = await duringStartup("context", () => browser.newContext(), startup);
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(
            "CSP violation",
            JSON.stringify({
              directive: event.effectiveDirective,
              blockedURI: event.blockedURI,
              source: event.sourceFile,
              line: event.lineNumber,
              policy: event.originalPolicy,
            }),
          );
        });
      });
      context.on("page", (page) => {
        page.on("console", (message) => {
          if (message.type() === "error") console.error("Browser console:", message.text(), message.location());
        });
        page.on("pageerror", (error) => console.error("Browser page error:", error.stack ?? error.message));
        page.on("requestfailed", (request) => {
          const message = `FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText}`;
          requests.push(message);
          console.error(message);
        });
        page.on("response", (response) => {
          const message = `${response.status()} ${response.request().resourceType()} ${response.url()}`;
          requests.push(message);
          if (response.status() >= 400) console.error(message);
        });
      });
      return context;
    };
    try {
      await check(newContext);
    } catch (error) {
      console.error("Smoke browser responses:\n" + requests.join("\n"));
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error("Browser diagnostics deadline exceeded")), 5_000);
      try {
        await Promise.race([
          new Promise<never>((_, reject) => {
            deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason), { once: true });
          }),
          (async () => {
            for (const context of browser.contexts()) {
              for (const page of context.pages()) {
                if (deadline.signal.aborted) return;
                try {
                  console.error("Final page:", page.url(), "\n" + (await page.evaluate(() => document.head.outerHTML)));
                } catch (diagnosticError) {
                  console.error("Could not capture page head:", diagnosticError);
                }
              }
            }
          })(),
        ]);
      } catch (diagnosticError) {
        console.error("Could not finish browser diagnostics:", diagnosticError);
      } finally {
        clearTimeout(timer);
      }
      throw error;
    }
  }, startup);
}
