import type { DiagramFile } from "../model/types";
import type { ImportOutcome } from "../interop/formats";
import { importAsyncApi, importCompose, importKubernetes, importTerraform } from "../interop/infra/pipeline";
import composeFixture from "../../tests/fixtures/imports/compose/docker-compose.yml?raw";
import ordersFixture from "../../tests/fixtures/imports/asyncapi/orders-service.asyncapi.yaml?raw";
import shippingFixture from "../../tests/fixtures/imports/asyncapi/shipping-service.asyncapi.yaml?raw";
import notificationsFixture from "../../tests/fixtures/imports/asyncapi/notifications-2.6.asyncapi.yaml?raw";
import k8sNamespaces from "../../tests/fixtures/imports/k8s/00-namespaces.yaml?raw";
import k8sData from "../../tests/fixtures/imports/k8s/data.yaml?raw";
import k8sIngress from "../../tests/fixtures/imports/k8s/ingress.yaml?raw";
import k8sOrders from "../../tests/fixtures/imports/k8s/orders-api.yaml?raw";
import k8sPayments from "../../tests/fixtures/imports/k8s/payments-worker.yaml?raw";
import tfAwsPlan from "../../tests/fixtures/imports/terraform/aws-plan.json?raw";
import tfAzureState from "../../tests/fixtures/imports/terraform/azure-state.json?raw";

// The infrastructure import fixtures (tests/fixtures/imports), imported the way Open… does, for the Lab: the
// overlap audit and a diagram to open in the editor. The Lab is a lazy chunk, so the YAML reader stays out of
// the startup JavaScript.

const diagramOf = (outcome: ImportOutcome): DiagramFile => {
  if (outcome.ok !== true) throw new Error(outcome.ok === false ? outcome.error : "unexpected outcome");
  return outcome.diagram;
};

/** tests/fixtures/imports/compose/docker-compose.yml, imported. */
export const importedCompose = (): DiagramFile =>
  diagramOf(importCompose([{ name: "docker-compose.yml", text: composeFixture }]));

/** The three AsyncAPI fixtures (3.0, 3.0 and 2.6), imported together and joined on their channels. */
export const importedAsyncApi = (): DiagramFile =>
  diagramOf(
    importAsyncApi([
      { name: "orders-service.asyncapi.yaml", text: ordersFixture },
      { name: "shipping-service.asyncapi.yaml", text: shippingFixture },
      { name: "notifications-2.6.asyncapi.yaml", text: notificationsFixture },
    ]),
  );

/** The five Kubernetes fixtures (tests/fixtures/imports/k8s), imported together. */
export const importedKubernetes = (): DiagramFile =>
  diagramOf(
    importKubernetes([
      { name: "00-namespaces.yaml", text: k8sNamespaces },
      { name: "data.yaml", text: k8sData },
      { name: "ingress.yaml", text: k8sIngress },
      { name: "orders-api.yaml", text: k8sOrders },
      { name: "payments-worker.yaml", text: k8sPayments },
    ]),
  );

/** The AWS plan fixture (tests/fixtures/imports/terraform): SNS → SQS → Lambda → DynamoDB, a module with MSK. */
export const importedTerraform = (): DiagramFile =>
  diagramOf(importTerraform([{ name: "aws-plan.json", text: tfAwsPlan }]));

/** The Azure state fixture: Service Bus, a Function App, Key Vault and Event Hubs in two resource groups. */
export const importedTerraformAzure = (): DiagramFile =>
  diagramOf(importTerraform([{ name: "azure-state.json", text: tfAzureState }]));
