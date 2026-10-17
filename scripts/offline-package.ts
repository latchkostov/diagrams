import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { hostingTemplates, type HostingOptions } from "./self-host-templates";
import { prepareSite } from "./prepare-site";
import { combinedNotes } from "./fragments";

export function offlineBuildEnv(
  shell: Record<string, string | undefined>,
  files: Record<string, string>,
): Record<string, string | undefined> {
  const configured = { ...files, ...shell };
  for (const [key, value] of Object.entries(configured))
    if (/^VITE_(GOOGLE|ONEDRIVE|DROPBOX)_/.test(key) && value)
      throw new Error(`Offline build requires ${key} to be unset (including .env files)`);
  return {
    ...shell,
    VITE_E2E: "",
    VITE_DISABLE_SHARE_LINKS: "1",
    VITE_DISABLE_LINK_OPEN: "1",
    VITE_DISABLE_AI_TOOLS: "1",
    VITE_DISABLE_ONDEVICE: "1",
    VITE_PRIVATE_BY_DEFAULT: "1",
  };
}

/** Environment key casing varies between Windows launchers; avoid Git tar's drive-letter interpretation. */
export function archiveTar(platform: string, env: Record<string, string | undefined>): string {
  if (platform !== "win32") return "tar";
  const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === "systemroot")?.[1];
  if (!systemRoot) throw new Error("Windows offline packaging needs SystemRoot");
  return win32.join(systemRoot, "System32", "tar.exe");
}

/** Explicit inputs only; never copies the checkout or local environment files into the archive. */
export function stageOffline(root: string, output: string, version: string, options: HostingOptions = {}): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(version)) throw new Error("Invalid archive version");
  const rejectLinks = (file: string) => {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("Offline bundle must not contain symlinks");
    if (stat.isDirectory()) for (const entry of readdirSync(file)) rejectLinks(join(file, entry));
  };
  rejectLinks(join(root, "dist"));
  const directory = join(output, `live-diagrams-${version}`);
  mkdirSync(directory, { recursive: true });
  cpSync(join(root, "dist"), join(directory, "site"), { recursive: true });
  prepareSite(join(directory, "site"), options.base);
  for (const [file, contents] of Object.entries(hostingTemplates(options))) {
    const target = join(directory, "headers", file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  for (const file of ["SELF-HOSTING.md", "EMBEDDING.md", "INTEROP.md"])
    cpSync(join(root, "docs", file), join(directory, file));
  writeFileSync(join(directory, "RELEASE-NOTES.md"), combinedNotes(root));
  cpSync(join(root, "LICENSE"), join(directory, "LICENSE"));
  writeFileSync(join(directory, "VERSION"), `${version}\n`);
  writeFileSync(
    join(directory, "README.md"),
    `# Live Diagrams offline bundle\n\nVersion: ${version}\n\n1. Verify SHA256SUMS with sha256sum -c SHA256SUMS inside this directory.\n2. Copy site/ into your HTTPS web root. No Node.js or package manager is needed at runtime.\n3. Install the appropriate config from headers/. For nginx, include headers/nginx/nginx.conf in http {}\n   and copy site/ into /usr/share/nginx/html${options.base ?? "/"}. For Caddy, install headers/caddy/Caddyfile\n   and copy site/ into /srv/live-diagrams (the prefix is stripped internally).\n4. Configure your own HTTPS and SSO. See SELF-HOSTING.md and EMBEDDING.md for policy and cookie details.\n\nThe included guide also describes source-checkout commands; this bundle contains generated headers/ instead\nof self-host-headers/ and does not include the source checkout, Docker recipe or Helm chart.\nPolicies use only the serving origin; no cloud providers or on-device model are configured in this build.\n`,
  );
  const sums: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Offline bundle must not contain symlinks: ${name}`);
      if (entry.isDirectory()) walk(name);
      else if (name !== "SHA256SUMS")
        sums.push(
          `${createHash("sha256")
            .update(readFileSync(join(directory, name)))
            .digest("hex")}  ${name}`,
        );
    }
  };
  walk("");
  writeFileSync(join(directory, "SHA256SUMS"), `${sums.join("\n")}\n`);
  return directory;
}
