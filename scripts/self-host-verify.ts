import { selfHostFlatCsp, selfHostHeadersFor, type SelfHostOptions } from "./self-host-headers";
import { AUTH_OPENER_POLICY } from "./security-headers";

export interface VerifyOptions extends SelfHostOptions {
  /** Static hosts cannot distinguish embeds by query: the allowlist applies to the app too. */
  flat?: boolean;
  cookie?: string;
}

const directives = (policy: string) => {
  const result = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    if (result.has(name)) throw new Error(`duplicate CSP directive: ${name}`);
    result.set(name, [...values].sort());
  }
  return result;
};

/** Fetch real responses (never follow sign-in redirects) and compare with the generated policy. */
export async function verifyInstance(
  address: string,
  options: VerifyOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const base = new URL(address);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error("URL must be an http(s) directory URL without credentials, query or fragment");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const problems: string[] = [];
  for (const suffix of ["", "?embed=1&host=1", "embed/live-diagram.js", "auth.html"]) {
    const url = new URL(suffix, base);
    const label = `${url.pathname}${url.search}`;
    try {
      const response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Origin: "https://self-host-verifier.example.com",
          ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
      });
      if (response.status !== 200) problems.push(`${label}: HTTP ${response.status} (check SSO and path routing)`);
      const expected = selfHostHeadersFor(url.href, options);
      // Static hosts use the flat policy on every response, including the module script.
      if (options.flat) expected["Content-Security-Policy"] = selfHostFlatCsp(options);
      for (const [key, value] of Object.entries(expected)) {
        const actual = response.headers.get(key);
        if (key === "Content-Security-Policy") {
          if (!actual) {
            problems.push(`${label}: missing ${key}`);
            continue;
          }
          const got = directives(actual);
          const wanted = directives(value);
          for (const name of got.keys())
            if (!wanted.has(name)) problems.push(`${label}: unexpected CSP directive ${name}`);
          for (const [name, sources] of wanted)
            if (JSON.stringify(got.get(name)) !== JSON.stringify(sources))
              problems.push(`${label}: CSP ${name} differs (expected ${sources.join(" ")})`);
        } else if (actual !== value)
          problems.push(`${label}: ${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
      }
      if (
        suffix === "auth.html" &&
        response.headers.has("Cross-Origin-Opener-Policy") &&
        response.headers.get("Cross-Origin-Opener-Policy") !== AUTH_OPENER_POLICY
      )
        problems.push(`${label}: omit Cross-Origin-Opener-Policy so OAuth popups can return`);
      const mime = response.headers.get("Content-Type") ?? "";
      if (suffix === "embed/live-diagram.js" ? !/javascript/i.test(mime) : !/text\/html/i.test(mime))
        problems.push(
          `${label}: unexpected Content-Type ${JSON.stringify(mime)} (possibly an SPA fallback or sign-in page)`,
        );
      await response.body?.cancel();
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}
