import { t } from "../i18n";
import type { SimRole } from "../model/types";

/** What each simulation role does, in the words shown in the stencil details drawer. */
export const roleExplained: Record<SimRole, string> = {
  get source() {
    return t("gallery.startsMessagesSimulatedTrafficBeginsHereUsersDevicesSchedulersAnd");
  },
  get topic() {
    return t("gallery.pubSubEveryOutgoingConnectionReceivesItsOwnCopyOf");
  },
  get queue() {
    return t("gallery.pointToPointEachMessageGoesToExactlyOneOutgoing");
  },
  get stream() {
    return t("gallery.anOrderedPartitionedLogLikeATopicEveryConsumerGets");
  },
  get processor() {
    return t("gallery.receivesAMessageDoesItsWorkThenForwardsTheResult");
  },
  get gateway() {
    return t("gallery.passesRequestsThroughToWhateverSitsBehindItWithoutHolding");
  },
  get store() {
    return t("gallery.persistsWhatArrivesMessagesEndTheirJourneyHere");
  },
  get sink() {
    return t("gallery.aTerminalConsumerMessagesEndHereWithoutBeingStoredLike");
  },
  get none() {
    return t("gallery.decorativeItIsnTPartOfTheMessageFlowSo");
  },
};

export interface IconSource {
  source: string;
  licence: string;
}

// Icons from sources other than gilbarbara/logos (the fallback below), by file name in docs/ICONS.md.
const THE_SVG = new Set(["sqlserver", "confluent", "keycloak", "microsoft-fabric"]);
const SIMPLE_ICONS = new Set([
  "pulsar",
  "camunda",
  "istio",
  "traefik",
  "cassandra",
  "minio",
  "stripe",
  "hubspot",
  "airbyte",
]);
const DEVICON = new Set(["haproxy", "clickhouse", "loki", "jaeger"]);

/** Where a stencil's icon comes from, condensed from docs/ICONS.md. */
export function iconSource(icon: string): IconSource {
  if (icon.startsWith("azure-"))
    return {
      source: "Microsoft Azure Architecture Icons V24",
      licence: t("gallery.microsoftIconTermsUseInArchitectureDiagramsUnaltered"),
    };
  if (icon.startsWith("aws-"))
    return {
      source: "AWS Architecture Icons (2026-07)",
      licence: t("gallery.aWSIconTermsUseInArchitectureDiagramsUnaltered"),
    };
  if (icon.startsWith("gcp-")) return { source: t("gallery.googleCloudIcons"), licence: "Apache-2.0" };
  if (icon.startsWith("k8s-"))
    return { source: t("gallery.kubernetesCommunityIcons"), licence: t("gallery.apache20OrCCBY40") };
  if (icon === "entra-id") return { source: "selfh.st icons", licence: t("gallery.cCBY40AttributionRequired") };
  if (THE_SVG.has(icon)) return { source: "theSVG", licence: "MIT" };
  if (SIMPLE_ICONS.has(icon))
    return { source: "Simple Icons", licence: t("gallery.cC0ArtworkTheLogoIsItsOwnerSTrademark") };
  if (DEVICON.has(icon)) return { source: "Devicon", licence: "MIT" };
  if (icon.startsWith("client-") || icon.startsWith("generic-") || icon === "net-firewall")
    return { source: "Lucide", licence: "ISC" };
  // Network device glyphs drawn for this app in Lucide's style (no vendor logos: docs/ICONS.md).
  if (icon.startsWith("net-")) return { source: "Live Diagrams", licence: "MIT" };
  return { source: "gilbarbara/logos", licence: t("gallery.cC0ArtworkTheLogoIsItsOwnerSTrademark") };
}
