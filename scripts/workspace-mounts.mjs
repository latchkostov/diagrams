import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Isolate service and integration workspaces. Never let Linux installs rewrite host workspace links. */
export function workspaceModuleMounts(root, volumePrefix) {
  return ["services", "integrations"].flatMap((directory) => {
    const packages = join(root, directory);
    if (!existsSync(packages)) return [];
    return readdirSync(packages, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^[a-zA-Z0-9_-]+$/.test(entry.name) &&
          existsSync(join(packages, entry.name, "package.json")),
      )
      .flatMap((entry) => [
        "--mount",
        `type=volume,source=${volumePrefix}-${directory === "services" ? "" : "integration-"}${entry.name},target=/work/${directory}/${entry.name}/node_modules,volume-nocopy`,
      ]);
  });
}
