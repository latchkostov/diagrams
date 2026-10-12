import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, EMBED_SCRIPT_HEADERS, PROVIDER_CONNECT } from "../../scripts/security-headers";
import {
  EXAMPLE_FRAME_ANCESTORS,
  frameAncestorList,
  headersFile,
  nginxHeaders,
  selfHostCsp,
  selfHostHeadersFor,
  selfHostSamples,
} from "../../scripts/self-host-headers";

// Headers for a self-hosted copy (docs/SELF-HOSTING.md): the public site's policy (scripts/security-headers.ts)
// with no outside origins and frame-ancestors limited to the company's own domains. deploy/self-host/ holds the
// samples `pnpm schemas` writes.

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ") ?? [];

describe("self-hosting headers", () => {
  it("deploy/self-host/ is generated from scripts/self-host-headers.ts (run `pnpm schemas` if this fails)", () => {
    for (const [name, text] of Object.entries(selfHostSamples()))
      expect(read(`deploy/self-host/${name}`), name).toBe(text);
  });

  it("is the public policy without outside origins", () => {
    for (const embed of [false, true]) {
      const csp = selfHostCsp({ embed });
      expect(csp).not.toMatch(/https?:/);
      for (const origin of PROVIDER_CONNECT) expect(csp).not.toContain(origin);
      for (const name of ["default-src", "script-src", "connect-src", "worker-src", "frame-src", "base-uri"])
        expect(directive(csp, name), name).toEqual(["'self'"]);
      expect(directive(csp, "object-src")).toEqual(["'none'"]);
      expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
      // The rest of the public policy is unchanged.
      const pub = contentSecurityPolicy({ embed });
      for (const name of ["img-src", "font-src", "media-src", "style-src"])
        expect(directive(pub, name).filter((v) => !/^https?:/.test(v))).toEqual(directive(csp, name));
    }
    // A copy built with a storage provider's variables keeps that provider's origins.
    expect(directive(selfHostCsp({ embed: false, providers: true }), "connect-src")).toEqual(
      directive(contentSecurityPolicy({ embed: false }), "connect-src"),
    );
  });

  it("lets only this site frame the app, and embeds only this site and the listed domains", () => {
    expect(directive(selfHostCsp({ embed: false }), "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(selfHostCsp({ embed: true }), "frame-ancestors")).toEqual(["'self'"]);
    const list = ["https://wiki.acme.com", "https://*.acme.com/"];
    expect(directive(selfHostCsp({ embed: false, frameAncestors: list }), "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(selfHostCsp({ embed: true, frameAncestors: list }), "frame-ancestors")).toEqual([
      "'self'",
      "https://wiki.acme.com",
      "https://*.acme.com",
    ]);
  });

  it("takes https origins only (plain http only on this machine), so nothing else can get into the policy", () => {
    expect(frameAncestorList(["http://127.0.0.1:*", "http://localhost:8080"])).toEqual([
      "http://127.0.0.1:*",
      "http://localhost:8080",
    ]);
    expect(
      frameAncestorList([" https://a.example.com ", "https://a.example.com", "https://b.example.com:8443"]),
    ).toEqual(["https://a.example.com", "https://b.example.com:8443"]);
    for (const bad of [
      "*",
      "http://a.example.com",
      "https://a.example.com/path",
      "https://a.com; script-src *",
      "'self'",
      "http://127.0.0.1.evil.com",
      "https://a.example.com:*",
    ])
      expect(() => frameAncestorList([bad]), bad).toThrow(/https origins/);
  });

  it("nginx: the embed policy for any embed parameter, the headers on every response", () => {
    const conf = nginxHeaders({ frameAncestors: EXAMPLE_FRAME_ANCESTORS });
    expect(conf).toContain(`default "${selfHostCsp({ embed: false, frameAncestors: EXAMPLE_FRAME_ANCESTORS })}";`);
    expect(conf).toContain(
      `"~(^|&)embed(=|&|$)" "${selfHostCsp({ embed: true, frameAncestors: EXAMPLE_FRAME_ANCESTORS })}";`,
    );
    expect(conf).toContain("add_header Content-Security-Policy $live_diagrams_csp always;");
    for (const header of [
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ])
      expect(conf).toMatch(new RegExp(`add_header ${header} "[^"]+" always;`));
    // The regex matches what the app treats as an embed (src/App.tsx: any `embed` parameter).
    const embed = /(^|&)embed(=|&|$)/;
    for (const args of ["embed=1", "example=x&embed=1", "embed", "embed&x=1"])
      expect(embed.test(args), args).toBe(true);
    for (const args of ["", "view=embed", "embedded=1", "x=embed"]) expect(embed.test(args), args).toBe(false);
  });

  it("_headers: one policy for every path, the embed one when domains are listed", () => {
    const plain = headersFile();
    expect(plain).toMatch(/^\/\*$/m);
    expect(plain).toContain(`  Content-Security-Policy: ${selfHostCsp({ embed: false })}\n`);
    const framed = headersFile({ frameAncestors: EXAMPLE_FRAME_ANCESTORS });
    expect(framed).toContain(
      `  Content-Security-Policy: ${selfHostCsp({ embed: true, frameAncestors: EXAMPLE_FRAME_ANCESTORS })}\n`,
    );
    expect(framed).toContain("  X-Content-Type-Options: nosniff\n");
  });

  it("per request, as nginx sends them: the embed policy for embeds, no opener policy on auth.html", () => {
    const list = { frameAncestors: ["https://wiki.acme.com"] };
    expect(selfHostHeadersFor("/?view=canvas", list)["Content-Security-Policy"]).toBe(
      selfHostCsp({ embed: false, ...list }),
    );
    expect(selfHostHeadersFor("/?embed=1&example=x", list)["Content-Security-Policy"]).toBe(
      selfHostCsp({ embed: true, ...list }),
    );
    expect(selfHostHeadersFor("/")["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(selfHostHeadersFor("/auth.html?code=x")["Cross-Origin-Opener-Policy"]).toBeUndefined();
    expect(selfHostHeadersFor("/")["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("lets other pages load the <live-diagram> script (private embeds): CORS and CORP for /embed/*.js", () => {
    for (const [k, v] of Object.entries(EMBED_SCRIPT_HEADERS)) {
      expect(selfHostHeadersFor("/embed/live-diagram.js")[k]).toBe(v);
      expect(selfHostHeadersFor("/tools/diagrams/embed/live-diagram.js")[k]).toBe(v);
      expect(selfHostHeadersFor("/")[k]).toBeUndefined();
      expect(selfHostHeadersFor("/?embed=1&host=1")[k]).toBeUndefined();
      expect(headersFile()).toContain(`/embed/*
`);
      expect(headersFile()).toContain(`  ${k}: ${v}
`);
      expect(nginxHeaders()).toContain(`add_header ${k} "${v}" always;`);
    }
    // nginx: the script's location repeats the other headers (a location with add_header drops inherited ones).
    const location = nginxHeaders().split("location ~ /embed/")[1] ?? "";
    expect(location).toContain("add_header Content-Security-Policy $live_diagrams_csp always;");
    expect(location).toContain("add_header X-Content-Type-Options");
    expect(EMBED_SCRIPT_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
  });
});
