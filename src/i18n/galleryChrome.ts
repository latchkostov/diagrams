import { t } from "./index";
import type { StencilCategory } from "../model/types";
import type { FamilyId } from "../lib/vendorFamilies";

// Descriptions belong to the stencil library, which loads separately from the canvas.
export const categoryBlurb: Record<StencilCategory, string> = {
  get messaging() {
    return t("chrome.brokersTopicsQueuesAndStreamsThatCarryMessagesBetweenServices");
  },
  get compute() {
    return t("chrome.whereCodeRunsServicesFunctionsContainersAndOrchestrators");
  },
  get data() {
    return t("chrome.databasesCachesObjectStorageAndAnalyticsPlatforms");
  },
  get network() {
    return t("chrome.gatewaysLoadBalancersAndEdgeNetworksInFrontOfServices");
  },
  get onprem() {
    return t("chrome.routersSwitchesFirewallsAndLoadBalancersInYourOwnRacks");
  },
  get observability() {
    return t("chrome.metricsLogsAndTraces");
  },
  get security() {
    return t("chrome.identitySecretsAndConfigurationStores");
  },
  get clients() {
    return t("chrome.peopleDevicesAndExternalSystemsAtTheEdgeOfThe");
  },
  get generic() {
    return t("chrome.vendorNeutralShapesForAnythingElse");
  },
};

export const familyHint: Record<FamilyId, string> = {
  get azure() {
    return t("chrome.azureServicesAndMicrosoftProducts");
  },
  get aws() {
    return t("chrome.amazonWebServices");
  },
  get gcp() {
    return t("chrome.googleCloudServices");
  },
  get streaming() {
    return t("chrome.kafkaPulsarRabbitMQNATSCDCAndStreamProcessors");
  },
  get oss() {
    return t("chrome.databasesRuntimesOrchestrationAndToolingYouCanSelfHost");
  },
  get saas() {
    return t("chrome.hostedPlatformsDataObservabilityIdentityPaymentsMessagingAndAIAPIs");
  },
  get generic() {
    return t("chrome.vendorNeutralShapesPeopleDevicesAndPartners");
  },
  get network() {
    return t("chrome.routersSwitchesFirewallsAndLoadBalancersCiscoJuniperPaloAlto");
  },
  get other() {
    return t("chrome.vendorsWithoutAFamilyYet");
  },
};
