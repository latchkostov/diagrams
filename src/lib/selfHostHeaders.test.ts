import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, PROVIDER_CONNECT } from "../../scripts/security-headers";
import {
  EXAMPLE_FRAME_ANCESTORS,
  frameAncestorList,
  headersFile,
  nginxHeaders,
  selfHostCsp,
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

  it("takes https origins only, so nothing else can get into the policy", () => {
    expect(
      frameAncestorList([" https://a.example.com ", "https://a.example.com", "https://b.example.com:8443"]),
    ).toEqual(["https://a.example.com", "https://b.example.com:8443"]);
    for (const bad of [
      "*",
      "http://a.example.com",
      "https://a.example.com/path",
      "https://a.com; script-src *",
      "'self'",
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
});
