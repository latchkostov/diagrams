import type { DiagramFile } from "../model/types";
import kafkaOrderPipeline from "./kafka-order-pipeline.json";
import azureServiceBusIntegration from "./azure-service-bus-integration.json";
import cdcAnalytics from "./cdc-analytics.json";
import awsFanout from "./aws-fanout.json";
import iotTelemetry from "./iot-telemetry.json";
import aksAppConfigKeyVault from "./aks-app-config-key-vault.json";

export interface Example {
  slug: string;
  diagram: DiagramFile;
  /** Local-only examples are never eligible for AI tools or prompts. */
  localOnly?: boolean;
}

// Work diagrams live in ./private (gitignored) and only load in dev, so they never ship in the public build.
const privateExamples: Example[] = import.meta.env.DEV
  ? Object.entries(import.meta.glob<DiagramFile>("./private/*.json", { eager: true, import: "default" })).map(
      ([path, diagram]) => ({ slug: path.slice("./private/".length, -".json".length), diagram, localOnly: true }),
    )
  : [];

export const examples: Example[] = [
  ...privateExamples,
  { slug: "kafka-order-pipeline", diagram: kafkaOrderPipeline as DiagramFile },
  { slug: "azure-service-bus-integration", diagram: azureServiceBusIntegration as DiagramFile },
  { slug: "cdc-analytics", diagram: cdcAnalytics as DiagramFile },
  { slug: "aws-fanout", diagram: awsFanout as DiagramFile },
  { slug: "iot-telemetry", diagram: iotTelemetry as DiagramFile },
  { slug: "aks-app-config-key-vault", diagram: aksAppConfigKeyVault as DiagramFile },
];
