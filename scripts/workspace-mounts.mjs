import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Match services/* in pnpm-workspace.yaml. Never let a Linux install rewrite host workspace links. */
export function workspaceModuleMounts(root, volumePrefix) {
  const services = join(root, "services");
  if (!existsSync(services)) return [];
  return readdirSync(services, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^[a-zA-Z0-9_-]+$/.test(entry.name) &&
        existsSync(join(services, entry.name, "package.json")),
    )
    .flatMap((entry) => [
      "--mount",
      `type=volume,source=${volumePrefix}-${entry.name},target=/work/services/${entry.name}/node_modules,volume-nocopy`,
    ]);
}
