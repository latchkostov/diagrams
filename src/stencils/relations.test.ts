import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { STENCIL_RELATIONS, inferRelation } from "./relations";
import { inferStencil } from "../interop/infer";
import { searchStencils } from "../lib/stencilSearch";
import { familyOf } from "../lib/vendorFamilies";
import { iconUrl } from "./registry";

const ids = new Set(catalog.map((s) => s.id));

describe("stencil relationships", () => {
  it("only name stencils that exist", () => {
    for (const id of Object.keys(STENCIL_RELATIONS)) expect(ids.has(id), id).toBe(true);
  });

  it.each([
    ["service.dotnet", "azure.key-vault", "secret"],
    ["aws.lambda", "aws.secrets-manager", "secret"],
    ["service.java", "gcp.secret-manager", "secret"],
    ["k8s.pod", "k8s.secret", "secret"],
    ["service.dotnet", "azure.app-config", "config"],
    ["k8s.deployment", "k8s.configmap", "config"],
    ["aws.lambda", "aws.parameter-store", "config"],
    ["service.dotnet", "azure.managed-identity", "identity"],
    ["client.browser", "entra-id", "identity"],
    ["aws.lambda", "aws.iam-role", "identity"],
    ["service.node", "generic.identity-provider", "identity"],
    ["service.node", "azure.app-insights", "telemetry"],
    ["aws.lambda", "aws.cloudwatch", "telemetry"],
    ["service.go", "kafka.schema-registry", "depends"],
    // A config store's entries referencing a vault.
    ["azure.app-config", "azure.key-vault", "secret"],
    ["aws.parameter-store", "aws.secrets-manager", "secret"],
    // A deploy source wins over the target's relation.
    ["github-actions", "azure.key-vault", "deploy"],
    ["terraform", "azure.app-config", "deploy"],
    ["argocd", "azure.aks", "deploy"],
    // Never inferred between services, brokers and stores, or into the OTel Collector.
    ["service.dotnet", "service.java", "flow"],
    ["service.dotnet", "kafka.topic", "flow"],
    ["service.dotnet", "postgres", "flow"],
    ["service.dotnet", "opentelemetry", "flow"],
    [undefined, "azure.key-vault", "secret"],
    ["service.dotnet", undefined, "flow"],
  ] as const)("%s → %s is %s", (from, to, want) => {
    expect(inferRelation(from, to)).toBe(want);
  });
});

describe("priority-1 config, secret and identity stencils", () => {
  const added = [
    "azure.app-config",
    "azure.managed-identity",
    "aws.secrets-manager",
    "aws.parameter-store",
    "aws.iam-role",
    "gcp.secret-manager",
    "k8s.configmap",
    "k8s.secret",
    "generic.config-store",
    "generic.secret-store",
    "generic.identity-provider",
    "aws.cloudwatch",
  ];

  it("exist with an icon, a known vendor family and a default relationship", () => {
    for (const id of added) {
      const s = catalog.find((x) => x.id === id)!;
      expect(s, id).toBeDefined();
      expect(iconUrl(s.icon), `${id} icon`).toBeTruthy();
      expect(familyOf(s), id).not.toBe("other");
      expect(STENCIL_RELATIONS[id]?.in, id).toBeTruthy();
    }
  });

  it.each([
    ["app config", "azure.app-config"],
    ["appcs", "azure.app-config"],
    ["kv refs", "azure.key-vault"],
    ["configmap", "k8s.configmap"],
    ["ssm", "aws.parameter-store"],
    ["irsa", "aws.iam-role"],
    ["workload identity", "azure.managed-identity"],
    ["identity provider", "generic.identity-provider"],
    ["cloudwatch", "aws.cloudwatch"],
  ])("search %s finds %s first", (q, id) => {
    expect(searchStencils(catalog, q)[0]?.id).toBe(id);
  });

  it.each([
    ["Azure App Configuration", "azure.app-config"],
    ["orders managed identity", "azure.managed-identity"],
    ["AWS Secrets Manager", "aws.secrets-manager"],
    ["GCP Secret Manager", "gcp.secret-manager"],
    ["SSM Parameter Store", "aws.parameter-store"],
    ["checkout IAM role", "aws.iam-role"],
    ["Kubernetes ConfigMap", "k8s.configmap"],
    ["k8s secret", "k8s.secret"],
    ["CloudWatch Logs", "aws.cloudwatch"],
    ["Config store", "generic.config-store"],
    ["Identity provider", "generic.identity-provider"],
    // Unchanged: Vault and Key Vault still win their own words.
    ["Key Vault", "azure.key-vault"],
    ["secrets", "vault"],
  ])("import text %s maps to %s", (text, id) => {
    expect(inferStencil(text)).toBe(id);
  });
});
