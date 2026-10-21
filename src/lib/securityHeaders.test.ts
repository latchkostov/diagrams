import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMON_HEADERS,
  contentSecurityPolicy,
  cspDirectives,
  securityHeadersFor,
  vercelConfig,
  vercelJson,
} from "../../scripts/security-headers";

// The security headers live in scripts/security-headers.ts; vercel.json is generated from it (`pnpm schemas`)
// and `vite preview` sends them through the same function, so the e2e suite (tests/e2e/csp.spec.ts) runs
// under exactly what production sends.

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const directive = (name: string, embed = false) => cspDirectives({ embed }).find(([n]) => n === name)?.[1] ?? [];

/** Whether a CSP source expression allows `url` (the subset this policy uses: origins, paths, *.host). */
function allows(source: string, url: string): boolean {
  const u = new URL(url);
  const m = /^(https):\/\/(\*\.)?([^/]+)(\/.*)?$/.exec(source);
  if (!m) return false;
  const [, scheme, wild, host, path] = m;
  if (u.protocol !== `${scheme}:`) return false;
  if (wild ? !u.hostname.endsWith(`.${host}`) : u.hostname !== host) return false;
  if (!path) return true;
  return path.endsWith("/") ? u.pathname.startsWith(path) : u.pathname === path;
}

describe("security headers", () => {
  it("vercel.json is generated from scripts/security-headers.ts (run `pnpm regen` if this fails)", () => {
    expect(read("vercel.json")).toBe(vercelJson());
    expect(JSON.parse(read("vercel.json"))).toEqual(vercelConfig());
  });

  it("keeps scripts strict: no inline scripts, no eval, no plugins", () => {
    const csp = contentSecurityPolicy({ embed: false });
    expect(csp).toContain("default-src 'self'");
    expect(directive("script-src")).toContain("'self'");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
    expect(directive("script-src").some((s) => /^(https?:|\*|data:|blob:)$/.test(s))).toBe(false);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'self'"]);
    expect(directive("form-action")).toEqual(["'self'"]);
    expect(directive("worker-src")).toEqual(["'self'"]);
    expect(directive("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directive("media-src")).toEqual(["'self'", "blob:"]);
    expect(directive("font-src")).toEqual(["'self'", "data:"]);
    expect(directive("connect-src")[0]).toBe("'self'");
  });

  it("lets anyone frame an embed, and only this site frame the app", () => {
    expect(directive("frame-ancestors", false)).toEqual(["'self'"]);
    expect(directive("frame-ancestors", true)).toEqual(["*"]);
    expect(securityHeadersFor("/")["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(securityHeadersFor("/?view=canvas&example=x")["Content-Security-Policy"]).toContain(
      "frame-ancestors 'self'",
    );
    expect(securityHeadersFor("/?embed=1&example=x")["Content-Security-Policy"]).toContain("frame-ancestors *");
    expect(securityHeadersFor("/tools/diagrams/?embed=1")["Content-Security-Policy"]).toContain("frame-ancestors *");
    // Any embed parameter is an embed (src/App.tsx shows the read-only viewer for it too).
    expect(securityHeadersFor("/?embed")["Content-Security-Policy"]).toContain("frame-ancestors *");
    expect(securityHeadersFor("/?view=embed")["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(read("src/App.tsx")).toContain(`new URLSearchParams(window.location.search).has("embed")`);
  });

  it("sends the same headers everywhere, without the opener policy on the sign-in redirect page", () => {
    for (const path of [
      "/",
      "/privacy.html",
      "/confluence.html",
      "/skill/",
      "/schema/diagram.v1.json",
      "/llms.txt",
      "/assets/x.js",
    ]) {
      const h = securityHeadersFor(path);
      expect(h["Referrer-Policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["X-Content-Type-Options"], path).toBe("nosniff");
      expect(h["Permissions-Policy"], path).toContain("microphone=(self)");
      expect(h["Permissions-Policy"], path).toContain("geolocation=()");
      expect(h["Cross-Origin-Opener-Policy"], path).toBe("same-origin-allow-popups");
    }
    expect(securityHeadersFor("/auth.html?code=x&state=y")["Cross-Origin-Opener-Policy"]).toBeUndefined();
    expect(securityHeadersFor("/auth.html")["Content-Security-Policy"]).toContain("script-src 'self'");
  });

  it("serves the <live-diagram> web component to other sites: CORS, cross-origin, cached for an hour", () => {
    for (const path of ["/embed/live-diagram.js", "/tools/diagrams/embed/live-diagram.js"]) {
      const h = securityHeadersFor(path);
      expect(h["Access-Control-Allow-Origin"], path).toBe("*");
      expect(h["Cross-Origin-Resource-Policy"], path).toBe("cross-origin");
      expect(h["Cache-Control"], path).toBe("public, max-age=3600, stale-while-revalidate=86400");
      expect(h["X-Content-Type-Options"], path).toBe("nosniff");
    }
    // Nothing else is opened up.
    for (const path of ["/", "/assets/index.js", "/?embed=1&host=1", "/embed/", "/embed/x/y.js"])
      expect(securityHeadersFor(path)["Access-Control-Allow-Origin"], path).toBeUndefined();
  });

  it("the app's page names the same referrer policy, for a copy served without the headers", () => {
    expect(read("index.html")).toContain(`<meta name="referrer" content="${COMMON_HEADERS["Referrer-Policy"]}" />`);
  });

  it("the host-supplied embed is framed by anyone, and talks to this site only (no storage provider)", () => {
    const csp = securityHeadersFor("/?embed=1&host=1&hostOrigin=https%3A%2F%2Fapp.example.com")[
      "Content-Security-Policy"
    ];
    expect(csp).toContain("frame-ancestors *");
    for (const name of ["script-src", "connect-src", "frame-src"]) expect(directive(name, true)).toEqual(["'self'"]);
    expect(directive("style-src", true)).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp).not.toMatch(/google|microsoft|dropbox|1drv|sharepoint/);
    // The app itself keeps them, for Save to and Open from.
    expect(directive("connect-src", false).length).toBeGreaterThan(1);
  });

  it("the Vercel rules route the same way as the preview server", () => {
    const rules = vercelConfig().headers;
    // Vercel's path-to-regexp source, as an anchored JS regex (the patterns here use only plain regex).
    const matches = (source: string, path: string) => new RegExp(`^${source}$`).test(path);
    const headersFor = (path: string, query: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const r of rules) {
        if (!matches(r.source, path)) continue;
        const hit = (c: { key: string; value?: string }) =>
          c.key in query && (c.value === undefined || query[c.key] === c.value);
        if ("has" in r && r.has && !r.has.every(hit)) continue;
        if ("missing" in r && r.missing && r.missing.some(hit)) continue;
        for (const { key, value } of r.headers) {
          expect(out[key], `two rules set ${key} for ${path}`).toBeUndefined();
          out[key] = value;
        }
      }
      return out;
    };
    for (const [path, query] of [
      ["/", {}],
      ["/", { embed: "1" }],
      ["/", { view: "canvas", example: "x" }],
      ["/auth.html", { code: "c", state: "s" }],
      ["/privacy.html", {}],
      ["/skill/", {}],
      ["/livediagrams-skill.zip", {}],
      ["/embed/live-diagram.js", {}],
      ["/", { embed: "1", host: "1", hostOrigin: "https://app.example.com" }],
    ] as [string, Record<string, string>][]) {
      expect(headersFor(path, query), `${path}?${new URLSearchParams(query)}`).toEqual(
        securityHeadersFor(`${path}?${new URLSearchParams(query)}`),
      );
    }
  });

  it("allows every endpoint the storage providers fetch, and nothing they only navigate to", () => {
    const files = [
      "src/interop/storage/onedrive.ts",
      "src/interop/storage/dropbox.ts",
      "src/interop/gdrive/client.ts",
      "src/interop/gdrive/google.ts",
    ];
    // Opened in the sign-in pop-up (a navigation, not a fetch), or a link in a comment.
    const navigationOnly = ["https://www.dropbox.com/oauth2/authorize", "https://developers.google.com/"];
    const scripts = ["https://accounts.google.com/gsi/client", "https://apis.google.com/js/api.js"];
    const urls = new Set(files.flatMap((f) => read(f).match(/https:\/\/[A-Za-z0-9.-]+[^\s"'`${}]*/g) ?? []));
    expect(urls.size).toBeGreaterThan(5);
    for (const url of urls) {
      if (navigationOnly.some((n) => url.startsWith(n))) continue;
      if (scripts.includes(url)) {
        expect(
          directive("script-src").some((s) => allows(s, url)),
          url,
        ).toBe(true);
        continue;
      }
      expect(
        directive("connect-src").some((s) => allows(s, url)),
        `${url} is fetched but not in connect-src`,
      ).toBe(true);
    }
    // OneDrive downloads: personal and work or school content hosts.
    for (const url of [
      "https://public.bn.files.1drv.com/y4m/file",
      "https://my.microsoftpersonalcontent.com/personal/x/_layouts/15/download.aspx",
      "https://contoso-my.sharepoint.com/personal/x/_layouts/15/download.aspx",
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    ])
      expect(
        directive("connect-src").some((s) => allows(s, url)),
        url,
      ).toBe(true);
    expect(directive("connect-src").some((s) => allows(s, "https://evil.example/"))).toBe(false);
  });

  it("no page the site serves has an inline script (the CSP would block it)", () => {
    const pages = [
      "index.html",
      "public/auth.html",
      "public/privacy.html",
      "public/confluence.html",
      "public/terms.html",
      "public/skill/index.html",
    ];
    const found = readdirSync(join(root, "public")).filter((f) => f.endsWith(".html"));
    for (const f of found) expect(pages, `add public/${f} here`).toContain(`public/${f}`);
    for (const page of pages) {
      const html = read(page);
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag, `${page}: ${tag}`).toMatch(/\bsrc=/);
      expect(html, page).not.toMatch(/\son[a-z]+=["']/);
      expect(html, page).not.toMatch(/href=["']javascript:/i);
    }
  });
});
