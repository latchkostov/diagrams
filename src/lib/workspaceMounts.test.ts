import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { workspaceModuleMounts } from "../../scripts/workspace-mounts.mjs";

it("isolates each service's Linux dependencies without copying or rewriting host links", () => {
  const root = mkdtempSync(join(tmpdir(), "ld-workspace-mounts-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  expect(workspaceModuleMounts(root, "modules-test")).toEqual([]);
  for (const name of ["server", "other", "not-a-package"]) mkdirSync(join(root, "services", name), { recursive: true });
  for (const name of ["server", "other"]) writeFileSync(join(root, "services", name, "package.json"), "{}");
  expect(workspaceModuleMounts(root, "modules-test")).toEqual([
    "--mount",
    "type=volume,source=modules-test-other,target=/work/services/other/node_modules,volume-nocopy",
    "--mount",
    "type=volume,source=modules-test-server,target=/work/services/server/node_modules,volume-nocopy",
  ]);
});

it("isolates integration packages even without services", () => {
  const root = mkdtempSync(join(tmpdir(), "ld-integration-mounts-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "integrations", "confluence-forge"), { recursive: true });
  writeFileSync(join(root, "integrations", "confluence-forge", "package.json"), "{}");
  expect(workspaceModuleMounts(root, "modules-test")).toEqual([
    "--mount",
    "type=volume,source=modules-test-integration-confluence-forge,target=/work/integrations/confluence-forge/node_modules,volume-nocopy",
  ]);
});
