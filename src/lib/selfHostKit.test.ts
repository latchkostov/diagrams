import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseAllDocuments } from "yaml";
import {
  AUTH_OPENER_POLICY,
  COMMON_HEADERS,
  EMBED_SCRIPT_HEADERS,
  OPENER_POLICY,
} from "../../scripts/security-headers";
import { archiveTar, offlineBuildEnv, stageOffline } from "../../scripts/offline-package";
import { prepareSite } from "../../scripts/prepare-site";
import { imageBuildArgs } from "../../scripts/self-host-image";
import { headersFile, selfHostCsp, selfHostFlatCsp, selfHostHeadersFor } from "../../scripts/self-host-headers";
import { hostingBase, hostingTemplates, nginxServer } from "../../scripts/self-host-templates";
import { verifyInstance } from "../../scripts/self-host-verify";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
const options = { frameAncestors: ["https://wiki.example.com"], base: "/tools/diagrams/" };

describe("self-host kit", () => {
  it("keeps committed target configs current (run `pnpm regen` if this fails)", () => {
    for (const [file, contents] of Object.entries(hostingTemplates()))
      expect(read(`deploy/self-host/${file}`), file).toBe(contents);
  });

  it("generates each host's CSP, common and module-script headers from the source", () => {
    const templates = hostingTemplates(options);
    for (const target of [
      "docker/default.conf",
      "nginx/nginx.conf",
      "caddy/Caddyfile",
      "netlify/netlify.toml",
      "vercel/vercel.json",
      "cloudflare/_headers",
      "azure/staticwebapp.config.json",
      "aws/embed-response-headers-policy.json",
    ]) {
      const text = templates[target];
      expect(text, target).toContain(selfHostCsp({ ...options, embed: true }));
      for (const [key, value] of Object.entries({ ...COMMON_HEADERS, ...EMBED_SCRIPT_HEADERS })) {
        expect(text, `${target}: ${key}`).toContain(key);
        expect(text, `${target}: ${value}`).toContain(value);
      }
      expect(text).not.toContain("frame-ancestors *");
    }
    for (const target of [
      "vercel/vercel.json",
      "azure/staticwebapp.config.json",
      "aws/response-headers-policy.json",
      "aws/embed-response-headers-policy.json",
      "aws/auth-response-headers-policy.json",
    ])
      expect(() => JSON.parse(templates[target]), target).not.toThrow();
    expect(templates["github-pages/meta-csp.html"]).not.toContain("frame-ancestors");
    expect(templates["github-pages/meta-csp.html"]).toContain("connect-src 'self'");
    const azure = JSON.parse(templates["azure/staticwebapp.config.json"]) as {
      routes: { route: string; headers: Record<string, string> }[];
    };
    expect(azure.routes.find((route) => route.route.endsWith("auth.html"))?.headers["Cross-Origin-Opener-Policy"]).toBe(
      "",
    );
    const aws = JSON.parse(templates["aws/auth-response-headers-policy.json"]) as {
      CustomHeadersConfig: { Items: { Header: string }[] };
    };
    expect(aws.CustomHeadersConfig.Items.some(({ Header }) => Header === "Cross-Origin-Opener-Policy")).toBe(false);
  });

  it("rejects configuration injection and generates complete sub-path routing with safe caches", () => {
    for (const base of ["tools/", "/tools", "/../", "/x;return 200/", "/$uri/", "/a b/", "/a\\b/"])
      expect(() => hostingBase(base), base).toThrow();
    expect(hostingBase(options.base)).toBe(options.base);
    const conf = nginxServer(options);
    expect(conf).toContain('~/auth\\.html$ ""');
    expect(conf).toContain("try_files $uri $uri/ /tools/diagrams/index.html");
    expect(conf).toContain("location /tools/diagrams/assets/ { try_files $uri =404; }");
    expect(conf).toContain("immutable");
    expect(conf).toContain('default "no-store"');
    expect(conf).toContain('map "$status:$uri"');
    expect(conf).toContain("~^(200|206|304):/tools/diagrams/assets/");
    const templates = hostingTemplates(options);
    expect(templates["caddy/Caddyfile"]).toContain("match status 200 206 304");
    expect(templates["caddy/Caddyfile"]).toContain("/tools/diagrams/?{http.request.uri.query}");
    const vercel = JSON.parse(templates["vercel/vercel.json"]) as {
      rewrites: { source: string; destination: string }[];
    };
    expect(vercel.rewrites[0]).toEqual({
      source: "/tools/diagrams/((?!assets/|embed/).*)",
      destination: "/tools/diagrams/index.html",
    });
    // All add_header directives stay at server level: no location silently drops security headers.
    expect(conf).not.toMatch(/\blocation\s+[^{}]+\{[^}]*add_header/s);
  });

  it("leaves Cloudflare static assets to Pages native SPA routing", () => {
    for (const base of ["/", options.base]) {
      const redirects = hostingTemplates({ base })["cloudflare/_redirects"];
      expect(redirects.split("\n").filter((line) => line.trim() && !line.startsWith("#"))).toEqual([]);
    }
  });

  it("shares base-aware header routes between legacy and Cloudflare output", () => {
    const legacy = headersFile(options);
    expect(legacy).toContain("\n/tools/diagrams/*\n");
    expect(legacy).toContain("\n/tools/diagrams/embed/*\n  Access-Control-Allow-Origin: *");
    expect(legacy).not.toContain("\n/embed/*\n");
    expect(hostingTemplates(options)["cloudflare/_headers"]).toContain(legacy);
  });

  it("keeps nginx redirects relative behind an HTTPS proxy", () => {
    expect(nginxServer(options)).toContain("absolute_redirect off;");
    expect(nginxServer(options)).toContain("return 308 /tools/diagrams/$is_args$args;");
  });

  it("keeps hosting-only Docker arguments after application compilation", () => {
    const dockerfile = read("Dockerfile");
    const build = dockerfile.indexOf("RUN node scripts/build-container.mjs");
    const prepare = dockerfile.indexOf("RUN pnpm self-host:prepare");
    for (const arg of ["BASE_PATH", "FRAME_ANCESTORS"]) {
      const declaration = dockerfile.indexOf(`ARG ${arg}=`);
      expect(declaration).toBeGreaterThan(build);
      expect(declaration).toBeLessThan(prepare);
    }
  });

  it("retains provider resource permissions on flat hosts even with a framing allowlist", () => {
    const flat = selfHostFlatCsp({ ...options, providers: true });
    expect(flat).toContain("https://www.googleapis.com");
    expect(flat).toContain("frame-ancestors 'self' https://wiki.example.com");
    for (const file of [
      "cloudflare/_headers",
      "netlify/netlify.toml",
      "azure/staticwebapp.config.json",
      "aws/response-headers-policy.json",
    ])
      expect(hostingTemplates({ ...options, providers: true })[file]).toContain(flat);
  });

  it("anchors relative startup assets at deep SPA URLs without changing source HTML", () => {
    const directory = mkdtempSync(join(tmpdir(), "diagrams-base-test-"));
    const file = join(directory, "index.html");
    try {
      writeFileSync(file, '<html><head><script src="./assets/start.js"></script></head></html>');
      prepareSite(directory, options.base);
      const html = readFileSync(file, "utf8");
      const href = html.match(/<base data-self-host="true" href="([^"]+)"/)?.[1];
      expect(href).toBe(options.base);
      expect(new URL("./assets/start.js", new URL(href!, "https://example.com/tools/diagrams/a/deep/route")).href).toBe(
        "https://example.com/tools/diagrams/assets/start.js",
      );
      prepareSite(directory, options.base);
      expect(readFileSync(file, "utf8")).toBe(html);
      writeFileSync(file, '<html><head><base href="/existing/"></head></html>');
      expect(() => prepareSite(directory)).toThrow(/already has a base/);
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("forces offline switches and rejects provider configuration from shell or env files", () => {
    const shell = {
      VITE_DISABLE_AI_TOOLS: "0",
      VITE_DISABLE_ONDEVICE: "0",
      VITE_BRAND_NAME: "Acme",
      VITE_LOCALES: "de",
      VITE_E2E: "1",
    };
    const env = offlineBuildEnv(shell, {});
    for (const key of [
      "VITE_DISABLE_SHARE_LINKS",
      "VITE_DISABLE_LINK_OPEN",
      "VITE_DISABLE_AI_TOOLS",
      "VITE_DISABLE_ONDEVICE",
      "VITE_PRIVATE_BY_DEFAULT",
    ])
      expect(env[key], key).toBe("1");
    expect(env.VITE_E2E).toBe("");
    expect(env.VITE_BRAND_NAME).toBe("Acme");
    expect(env.VITE_LOCALES).toBe("de");
    for (const key of ["VITE_GOOGLE_CLIENT_ID", "VITE_ONEDRIVE_CLIENT_ID", "VITE_DROPBOX_APP_KEY"])
      for (const [shellEnv, files] of [
        [{ [key]: "configured" }, {}],
        [{}, { [key]: "configured" }],
      ])
        expect(() => offlineBuildEnv(shellEnv, files)).toThrow(key);
    expect(
      offlineBuildEnv({ VITE_GOOGLE_CLIENT_ID: "" }, { VITE_GOOGLE_CLIENT_ID: "overridden" }).VITE_GOOGLE_CLIENT_ID,
    ).toBe("");
  });

  it("uses the native Windows archive tool with case-insensitive environment keys", () => {
    for (const key of ["SystemRoot", "SYSTEMROOT", "systemroot"])
      expect(archiveTar("win32", { [key]: "C:\\Windows" })).toBe("C:\\Windows\\System32\\tar.exe");
    expect(archiveTar("linux", {})).toBe("tar");
    expect(() => archiveTar("win32", {})).toThrow(/SystemRoot/);
  });

  it("ships parseable Kubernetes examples with non-root, read-only pods and health probes", () => {
    for (const file of ["manifest.yaml", "ingress.example.yaml"]) {
      const docs = parseAllDocuments(read(`deploy/self-host/kubernetes/${file}`));
      expect(docs.every((doc) => !doc.errors.length)).toBe(true);
    }
    const deployment = parseAllDocuments(read("deploy/self-host/kubernetes/manifest.yaml"))[0].toJS() as {
      spec: {
        template: {
          spec: {
            securityContext: { runAsNonRoot: boolean };
            containers: {
              securityContext: { readOnlyRootFilesystem: boolean };
              readinessProbe: { httpGet: { path: string } };
            }[];
          };
        };
      };
    };
    expect(deployment.spec.template.spec.securityContext.runAsNonRoot).toBe(true);
    expect(deployment.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem).toBe(true);
    expect(deployment.spec.template.spec.containers[0].readinessProbe.httpGet.path).toBe("/healthz");
  });

  it("builds the image from the chart's real switch values without adding runtime flags", () => {
    const values = parseAllDocuments(read("deploy/self-host/helm/values.yaml"))[0].toJS() as {
      image: { repository: string; tag: string };
      build: { switches: Record<string, string>; basePath: string; frameAncestors: string };
    };
    values.image.repository = "registry.example.com:5000/diagrams";
    values.image.tag = "release-1";
    values.build.switches.VITE_BRAND_NAME = "Acme Diagrams";
    values.build.basePath = options.base;
    values.build.frameAncestors = "https://wiki.example.com";
    const args = imageBuildArgs(values);
    expect(args.slice(0, 3)).toEqual(["build", "--tag", "registry.example.com:5000/diagrams:release-1"]);
    expect(args).toContain("VITE_BRAND_NAME=Acme Diagrams");
    expect(args).toContain("VITE_DISABLE_AI_TOOLS=1");
    expect(args).toContain(`BASE_PATH=${options.base}`);
    expect(args).toContain("FRAME_ANCESTORS=https://wiki.example.com");
    expect(args.at(-1)).toBe(".");
    values.build.switches.UNKNOWN = "1";
    expect(() => imageBuildArgs(values)).toThrow(/Unknown build switch/);
    expect(() => imageBuildArgs(null)).toThrow(/mapping/);
  });

  it("packages only built files, generated headers, public docs and license with verifiable checksums", () => {
    const scratch = mkdtempSync(join(tmpdir(), "diagrams-package-test-"));
    try {
      const input = join(scratch, "input");
      mkdirSync(join(input, "dist"), { recursive: true });
      mkdirSync(join(input, "docs"));
      writeFileSync(join(input, "dist", "index.html"), "<html><head></head><body>built site</body></html>");
      writeFileSync(join(input, ".env.local"), "SECRET=must-not-ship");
      for (const file of ["SELF-HOSTING.md", "EMBEDDING.md", "INTEROP.md"])
        writeFileSync(join(input, "docs", file), "documentation");
      mkdirSync(join(input, "docs/release-notes"));
      writeFileSync(join(input, "docs/RELEASE-NOTES-HISTORY.md"), "# Release notes\n\n## Older\n\nHistory.\n");
      writeFileSync(join(input, "docs/release-notes/2026-10-17-new.md"), "## New\n\nCurrent release.\n");
      writeFileSync(join(input, "LICENSE"), "license");
      const output = stageOffline(input, join(scratch, "output"), "1.2.3-abcd");
      expect(readFileSync(join(output, "RELEASE-NOTES.md"), "utf8")).toBe(
        "# Release notes\n\n## New\n\nCurrent release.\n\n## Older\n\nHistory.\n",
      );
      const sums = readFileSync(join(output, "SHA256SUMS"), "utf8");
      expect(sums).not.toContain(".env");
      expect(sums).toContain("site/index.html");
      expect(sums).toContain("headers/docker/default.conf");
      expect(sums).toContain("README.md");
      for (const line of sums.trim().split("\n")) {
        const [hash, file] = line.split("  ");
        expect(
          createHash("sha256")
            .update(readFileSync(join(output, file)))
            .digest("hex"),
          file,
        ).toBe(hash);
      }
      expect(() => stageOffline(input, scratch, "../escape")).toThrow();
      const external = join(scratch, "external");
      mkdirSync(external);
      symlinkSync(external, join(input, "dist", "linked"), "junction");
      expect(() => stageOffline(input, join(scratch, "linked-output"), "1.2.3")).toThrow(/symlinks/);
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe("deployed header verification", () => {
  const fetcher = (change: (headers: Record<string, string>, url: URL) => void = () => {}) =>
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const headers = selfHostHeadersFor(url.href, options);
      headers["Content-Type"] = url.pathname.endsWith(".js") ? "application/javascript" : "text/html";
      change(headers, url);
      return new Response("site", { headers });
    });

  it("checks a sub-path's app, query embed, CORS module and auth page without following SSO redirects", async () => {
    const mock = fetcher();
    expect(await verifyInstance("https://diagrams.example.com/tools/diagrams", options, mock)).toEqual([]);
    expect(mock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://diagrams.example.com/tools/diagrams/",
      "https://diagrams.example.com/tools/diagrams/?embed=1&host=1",
      "https://diagrams.example.com/tools/diagrams/embed/live-diagram.js",
      "https://diagrams.example.com/tools/diagrams/auth.html",
    ]);
    expect(mock.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });

  it.each([
    ...Object.keys(COMMON_HEADERS),
    "Content-Security-Policy",
    "Cross-Origin-Opener-Policy",
    ...Object.keys(EMBED_SCRIPT_HEADERS),
  ])("detects a missing %s", async (key) => {
    const problems = await verifyInstance(
      "https://diagrams.example.com/",
      options,
      fetcher((headers) => {
        Reflect.deleteProperty(headers, key);
      }),
    );
    expect(problems.some((problem) => problem.includes(key))).toBe(true);
  });

  it("rejects weakened CSP, incorrect embed framing, duplicate directives and auth COOP", async () => {
    for (const replacement of ["script-src 'self' 'unsafe-inline'", "script-src 'none'; script-src 'self'"]) {
      const mock = fetcher((headers) => {
        headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(
          /script-src [^;]+/,
          replacement,
        );
      });
      expect((await verifyInstance("https://diagrams.example.com/", options, mock)).length).toBeGreaterThan(0);
    }
    const mock = fetcher((headers, url) => {
      if (url.pathname.endsWith("auth.html")) headers["Cross-Origin-Opener-Policy"] = OPENER_POLICY;
    });
    expect(await verifyInstance("https://diagrams.example.com/", options, mock)).toContain(
      "/auth.html: omit Cross-Origin-Opener-Policy so OAuth popups can return",
    );
    const defaultOpener = fetcher((headers, url) => {
      if (url.pathname.endsWith("auth.html")) headers["Cross-Origin-Opener-Policy"] = AUTH_OPENER_POLICY;
    });
    expect(await verifyInstance("https://diagrams.example.com/", options, defaultOpener)).toEqual([]);
    expect(hostingTemplates()["netlify/netlify.toml"]).toContain(
      `"Cross-Origin-Opener-Policy" = "${AUTH_OPENER_POLICY}"`,
    );
    for (const extra of ["script-src-elem *", "script-src-attr 'unsafe-inline'"]) {
      const loose = fetcher((headers) => {
        headers["Content-Security-Policy"] += `; ${extra}`;
      });
      const problems = await verifyInstance("https://diagrams.example.com/", options, loose);
      expect(problems.some((problem) => problem.includes("unexpected CSP directive"))).toBe(true);
    }
  });

  it("rejects wildcard embed frame-ancestors with otherwise valid CSP", async () => {
    const mock = fetcher((headers, url) => {
      if (url.searchParams.has("embed"))
        headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(
          /frame-ancestors [^;]+/,
          "frame-ancestors *",
        );
    });
    expect(await verifyInstance("https://diagrams.example.com/", options, mock)).toEqual([
      "/?embed=1&host=1: CSP frame-ancestors differs (expected 'self' https://wiki.example.com)",
    ]);
  });

  it("rejects wildcard connect-src with otherwise valid CSP", async () => {
    const mock = fetcher((headers, url) => {
      if (!url.search && url.pathname === "/")
        headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(
          /connect-src [^;]+/,
          "connect-src *",
        );
    });
    expect(await verifyInstance("https://diagrams.example.com/", options, mock)).toEqual([
      "/: CSP connect-src differs (expected 'self')",
    ]);
  });

  it("supports explicitly declared flat-host framing and reports redirects, HTML modules and unreachable hosts", async () => {
    const mock = fetcher((headers) => {
      headers["Content-Security-Policy"] = selfHostCsp({ ...options, embed: true });
    });
    expect(await verifyInstance("https://diagrams.example.com/", { ...options, flat: true }, mock)).toEqual([]);
    for (const frameAncestors of [[], options.frameAncestors]) {
      const providerOptions = { frameAncestors, providers: true, flat: true };
      const providers = fetcher((headers) => {
        headers["Content-Security-Policy"] = selfHostFlatCsp(providerOptions);
      });
      expect(await verifyInstance("https://diagrams.example.com/", providerOptions, providers)).toEqual([]);
    }
    expect((await verifyInstance("https://diagrams.example.com/", options, mock)).length).toBeGreaterThan(0);
    const redirect = vi.fn<typeof fetch>(
      async () => new Response("login", { status: 302, headers: { "Content-Type": "text/html" } }),
    );
    const problems = await verifyInstance("https://diagrams.example.com/", options, redirect);
    expect(problems.some((problem) => problem.includes("HTTP 302"))).toBe(true);
    expect(problems.some((problem) => problem.includes("unexpected Content-Type"))).toBe(true);
    const offline = vi.fn<typeof fetch>(async () => {
      throw new Error("unreachable");
    });
    expect(await verifyInstance("https://diagrams.example.com/", options, offline)).toHaveLength(4);
  });
});
