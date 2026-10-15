import type { Quota } from "./admission";
import type { NodeSimProps } from "../sim/types";

/** Small immutable values shared by creation and the lazy profile resolver. */
export const ADMISSION_REVISION = "2026-10-14";
export const ADMISSION_PRESETS: Readonly<Record<string, Partial<NodeSimProps>>> = {
  "lambda-account": {
    scaling: "auto",
    maxConcurrency: 1000,
    latencyMs: 250,
    concurrency: 1,
    api: { sharedConcurrency: "lambda-account-region", maxInFlight: 1000 },
  },
  "stripe-live": {
    latencyMs: 250,
    api: {
      maxInFlight: 50,
      sharedConcurrency: "stripe-live-account",
      quotas: [
        {
          id: "global-rate",
          unit: "requests",
          amount: 100,
          windowMs: 1000,
          algorithm: "token-bucket",
          sharedGroup: "stripe-live-account",
        },
      ],
    },
  },
  "stripe-sandbox": {
    latencyMs: 250,
    api: {
      quotas: [
        {
          id: "global-rate",
          unit: "requests",
          amount: 25,
          windowMs: 1000,
          algorithm: "token-bucket",
          sharedGroup: "stripe-sandbox-account",
        },
      ],
    },
  },
  "api-gateway-account": {
    latencyMs: 60,
    api: {
      quotas: [
        {
          id: "global-rate",
          unit: "requests",
          amount: 10000,
          burst: 5000,
          windowMs: 1000,
          algorithm: "token-bucket",
          sharedGroup: "api-gateway-account-region",
        },
      ],
    },
  },
  "managed-measured": { latencyMs: 250, failureRate: 0 },
};
export function admissionPresetFor(stencil?: string): string | undefined {
  if (stencil === "aws.lambda") return "lambda-account";
  if (stencil === "stripe") return "stripe-live";
  if (stencil === "aws.api-gateway") return "api-gateway-account";
  return undefined;
}
export function managedKind(stencil: string): "serverless" | "api" | undefined {
  if (["aws.lambda", "azure.functions", "gcp.cloud-functions", "cloudflare.workers"].includes(stencil))
    return "serverless";
  if (
    [
      "stripe",
      "iterable",
      "braze",
      "segment",
      "shopify",
      "paypal",
      "adyen",
      "twilio",
      "sendgrid",
      "salesforce",
      "hubspot",
      "slack",
      "client.partner",
      "generic.external-api",
      "generic.email",
      "generic.push",
      "generic.sms",
      "generic.marketing",
      "openai",
      "anthropic.claude",
      "generic.ml-model",
      "generic.llm",
      "aws.api-gateway",
      "azure.api-management",
      "graphql",
      "kong",
    ].includes(stencil)
  )
    return "api";
  return undefined;
}

/** The simple RPS control must bank enough credit for at least one real request. */
export const localRateQuota = (amount: number): Quota => ({
  id: "local-rate",
  unit: "requests",
  amount,
  windowMs: 1000,
  algorithm: "token-bucket",
  burst: Math.max(1, amount),
});
