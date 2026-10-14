import { t } from "./index";
import type { AnnotationColor, AnnotationKind, AnnotationShape, StencilCategory } from "../model/types";
import type { GroupTone } from "../canvas/types";
import type { DependencyRelation } from "../model/relations";
import type { FamilyId } from "../lib/vendorFamilies";
export const categoryLabel: Record<StencilCategory, string> = {
  get messaging() {
    return t("chrome.messaging");
  },
  get compute() {
    return t("chrome.compute");
  },
  get data() {
    return t("chrome.data");
  },
  get network() {
    return t("chrome.network");
  },
  get onprem() {
    return t("chrome.onPremNetwork");
  },
  get observability() {
    return t("chrome.observability");
  },
  get security() {
    return t("chrome.securityConfig");
  },
  get clients() {
    return t("chrome.clientsExternal");
  },
  get generic() {
    return t("chrome.generic");
  },
};
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
export const kindLabel: Record<AnnotationKind, string> = {
  get text() {
    return t("library.text");
  },
  get note() {
    return t("library.note");
  },
  get zone() {
    return t("library.zone");
  },
  get shape() {
    return t("menu.shape");
  },
};
export const shapeLabel: Record<AnnotationShape, string> = {
  get rect() {
    return t("chrome.rectangle");
  },
  get rounded() {
    return t("chrome.roundedRectangle");
  },
  get ellipse() {
    return t("chrome.ellipse");
  },
  get diamond() {
    return t("chrome.diamond");
  },
  get cylinder() {
    return t("chrome.cylinder");
  },
};
export const toneLabel: Record<GroupTone, string> = {
  get azure() {
    return t("chrome.azure");
  },
  get aws() {
    return t("chrome.aWS");
  },
  get gcp() {
    return t("chrome.googleCloud");
  },
  get k8s() {
    return t("chrome.kubernetes");
  },
  get onprem() {
    return t("chrome.onPremises");
  },
  get neutral() {
    return t("chrome.neutral");
  },
};
export const colorLabel: Record<AnnotationColor, string> = {
  get white() {
    return t("chrome.white");
  },
  get neutral() {
    return t("chrome.grey");
  },
  get yellow() {
    return t("chrome.yellow");
  },
  get green() {
    return t("chrome.green");
  },
  get blue() {
    return t("chrome.blue");
  },
  get purple() {
    return t("chrome.purple");
  },
  get red() {
    return t("chrome.red");
  },
};
export const relationLabel: Record<DependencyRelation, string> = {
  get config() {
    return t("chrome.config");
  },
  get secret() {
    return t("chrome.secret");
  },
  get identity() {
    return t("chrome.identity");
  },
  get telemetry() {
    return t("chrome.telemetry");
  },
  get deploy() {
    return t("chrome.deploys");
  },
  get depends() {
    return t("chrome.dependsOn");
  },
};
export const relationNoun: Record<DependencyRelation, string> = {
  get config() {
    return t("chrome.configDependency");
  },
  get secret() {
    return t("chrome.secretDependency");
  },
  get identity() {
    return t("chrome.identityDependency");
  },
  get telemetry() {
    return t("chrome.telemetry");
  },
  get deploy() {
    return t("chrome.deployment");
  },
  get depends() {
    return t("chrome.dependency");
  },
};
export const familyLabel: Record<FamilyId, string> = {
  get azure() {
    return t("chrome.azure");
  },
  get aws() {
    return t("chrome.aWS");
  },
  get gcp() {
    return t("chrome.googleCloud");
  },
  get streaming() {
    return t("chrome.kafkaStreaming");
  },
  get oss() {
    return t("chrome.openSource");
  },
  get saas() {
    return t("chrome.saaS");
  },
  get generic() {
    return t("chrome.genericClients");
  },
  get network() {
    return t("chrome.networkVendors");
  },
  get other() {
    return t("chrome.other");
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
