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
  get stadium() {
    return t("shape.stadium");
  },
  get subroutine() {
    return t("shape.subroutine");
  },
  get "dbl-circ"() {
    return t("shape.dblCirc");
  },
  get hexagon() {
    return t("shape.hexagon");
  },
  get "lean-r"() {
    return t("shape.leanR");
  },
  get "lean-l"() {
    return t("shape.leanL");
  },
  get "trap-b"() {
    return t("shape.trapB");
  },
  get "trap-t"() {
    return t("shape.trapT");
  },
  get "sl-rect"() {
    return t("shape.slRect");
  },
  get "notch-rect"() {
    return t("shape.notchRect");
  },
  get "lin-rect"() {
    return t("shape.linRect");
  },
  get "div-rect"() {
    return t("shape.divRect");
  },
  get "tag-rect"() {
    return t("shape.tagRect");
  },
  get processes() {
    return t("shape.processes");
  },
  get delay() {
    return t("shape.delay");
  },
  get "notch-pent"() {
    return t("shape.notchPent");
  },
  get hourglass() {
    return t("shape.hourglass");
  },
  get fork() {
    return t("shape.fork");
  },
  get datastore() {
    return t("shape.datastore");
  },
  get das() {
    return t("shape.das");
  },
  get "lin-cyl"() {
    return t("shape.linCyl");
  },
  get "bow-rect"() {
    return t("shape.bowRect");
  },
  get flag() {
    return t("shape.flag");
  },
  get "win-pane"() {
    return t("shape.winPane");
  },
  get doc() {
    return t("shape.doc");
  },
  get docs() {
    return t("shape.docs");
  },
  get "lin-doc"() {
    return t("shape.linDoc");
  },
  get "tag-doc"() {
    return t("shape.tagDoc");
  },
  get bolt() {
    return t("shape.bolt");
  },
  get comment() {
    return t("shape.comment");
  },
  get "brace-r"() {
    return t("shape.braceR");
  },
  get braces() {
    return t("shape.braces");
  },
  get "curv-trap"() {
    return t("shape.curvTrap");
  },
  get asym() {
    return t("shape.asym");
  },
  get "f-circ"() {
    return t("shape.fCirc");
  },
  get "framed-circle"() {
    return t("shape.framedCircle");
  },
  get "cross-circ"() {
    return t("shape.crossCirc");
  },
  get tri() {
    return t("shape.tri");
  },
  get "flip-tri"() {
    return t("shape.flipTri");
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
