import { msg } from "../../i18n";
import { formatList } from "../../i18n/format";
import type { ImportText, ReportLine } from "../infra/graph";

// Literal keys let the build inline English without carrying the catalog or ICU parser.
export const messages = {
  "importReport.namedCount": msg("importReport.namedCount"),
  "importDetail.aHelmTemplateImportHelmTemplate": msg("importDetail.aHelmTemplateImportHelmTemplate"),
  "importDetail.aMessageNoChannelUses": msg("importDetail.aMessageNoChannelUses"),
  "importDetail.aValue0WithNoName": msg("importDetail.aValue0WithNoName"),
  "importDetail.anEmailSMSOrAppSubscription": msg("importDetail.anEmailSMSOrAppSubscription"),
  "importDetail.connectionsFromSubscriptionsMappingsAndGrants": msg(
    "importDetail.connectionsFromSubscriptionsMappingsAndGrants",
  ),
  "importDetail.dataSource": msg("importDetail.dataSource"),
  "importDetail.destroyedByThisPlan": msg("importDetail.destroyedByThisPlan"),
  "importDetail.developerTool": msg("importDetail.developerTool"),
  "importDetail.emulatesAWSItsServicesArentKnown": msg("importDetail.emulatesAWSItsServicesArentKnown"),
  "importDetail.foldedIntoItsOwner": msg("importDetail.foldedIntoItsOwner"),
  "importDetail.itsACLsArentDrawnNoWorkload": msg("importDetail.itsACLsArentDrawnNoWorkload"),
  "importDetail.modulesNestedMoreThanValue0Deep": msg("importDetail.modulesNestedMoreThanValue0Deep"),
  "importDetail.noOperationInValue0UsesIt": msg("importDetail.noOperationInValue0UsesIt"),
  "importDetail.noTypeOrName": msg("importDetail.noTypeOrName"),
  "importDetail.noWorkloadUsesIt": msg("importDetail.noWorkloadUsesIt"),
  "importDetail.notAComponent": msg("importDetail.notAComponent"),
  "importDetail.notAKubernetesResourceNoKind": msg("importDetail.notAKubernetesResourceNoKind"),
  "importDetail.notAServiceDefinition": msg("importDetail.notAServiceDefinition"),
  "importDetail.notComponentsOfTheSystem": msg("importDetail.notComponentsOfTheSystem"),
  "importDetail.notListed": msg("importDetail.notListed"),
  "importDetail.notReadADifferentKindOf": msg("importDetail.notReadADifferentKindOf"),
  "importDetail.partOfKafka": msg("importDetail.partOfKafka"),
  "importDetail.planValue0ToAddValue1To": msg("importDetail.planValue0ToAddValue1To"),
  "importDetail.profiles": msg("importDetail.profiles"),
  "importDetail.scalesAWorkloadThatIsntIn": msg("importDetail.scalesAWorkloadThatIsntIn"),
  "importDetail.schemaRegistryAddedMessagesOnValue0": msg("importDetail.schemaRegistryAddedMessagesOnValue0"),
  "importDetail.settingsPastTheFirstValue0Number": msg("importDetail.settingsPastTheFirstValue0Number"),
  "importDetail.shownAsItsWorkloadsFlows": msg("importDetail.shownAsItsWorkloadsFlows"),
  "importDetail.shownThroughItsTopics": msg("importDetail.shownThroughItsTopics"),
  "importDetail.someReferencesWerentFollowedThePlan": msg("importDetail.someReferencesWerentFollowedThePlan"),
  "importDetail.supporting": msg("importDetail.supporting"),
  "importDetail.terraformSourceImportTerraformShowJson": msg("importDetail.terraformSourceImportTerraformShowJson"),
  "importDetail.terraformTypeNotDrawn": msg("importDetail.terraformTypeNotDrawn"),
  "importDetail.unknownKindValue0": msg("importDetail.unknownKindValue0"),
  "importDetail.value0AServiceWithValue1In": msg("importDetail.value0AServiceWithValue1In"),
  "importDetail.value0HasNoProducerInThese": msg("importDetail.value0HasNoProducerInThese"),
  "importDetail.value0IsAQueueValue1Sends": msg("importDetail.value0IsAQueueValue1Sends"),
  "importDetail.value0IsOnValue1ShownIn": msg("importDetail.value0IsOnValue1ShownIn"),
  "importDetail.value0IsTheDeadletterRouteOf": msg("importDetail.value0IsTheDeadletterRouteOf"),
  "importDetail.value0KafkaUserMayValue1value2NotDrawn": msg("importDetail.value0KafkaUserMayValue1value2NotDrawn"),
  "importDetail.value0RunsUpToValue1Jobs": msg("importDetail.value0RunsUpToValue1Jobs"),
  "importDetail.value0ScalesFromValue1ToValue2": msg("importDetail.value0ScalesFromValue1ToValue2"),
  "importDetail.value0ScalesFromValue1ToValue2More": msg("importDetail.value0ScalesFromValue1ToValue2More"),
  "importDetail.value0SendsToValue1WhichInputs": msg("importDetail.value0SendsToValue1WhichInputs"),
  "importDetail.value0TriggerScalingOnly": msg("importDetail.value0TriggerScalingOnly"),
  "importDetail.volume": msg("importDetail.volume"),
  "importKind.accessAndPermissions": msg("importKind.accessAndPermissions"),
  "importKind.connectionsWithNoEndsHere": msg("importKind.connectionsWithNoEndsHere"),
  "importKind.dataSources": msg("importKind.dataSources"),
  "importKind.helpers": msg("importKind.helpers"),
  "importKind.monitoring": msg("importKind.monitoring"),
  "importKind.more": msg("importKind.more"),
  "importKind.networking": msg("importKind.networking"),
  "importKind.otherTypes": msg("importKind.otherTypes"),
  "importKind.parts": msg("importKind.parts"),
  "importReason.aSecretsValueNeverRead": msg("importReason.aSecretsValueNeverRead"),
  "importReason.accessAndPermissions": msg("importReason.accessAndPermissions"),
  "importReason.anEnabledAPI": msg("importReason.anEnabledAPI"),
  "importReason.connectsNothingInTheseFiles": msg("importReason.connectsNothingInTheseFiles"),
  "importReason.dataSource": msg("importReason.dataSource"),
  "importReason.encryptionKey": msg("importReason.encryptionKey"),
  "importReason.helperNotInfrastructure": msg("importReason.helperNotInfrastructure"),
  "importReason.hostingPlan": msg("importReason.hostingPlan"),
  "importReason.monitoring": msg("importReason.monitoring"),
  "importReason.networking": msg("importReason.networking"),
  "importReason.partOf": msg("importReason.partOf"),
  "importReason.partOfALoadBalancer": msg("importReason.partOfALoadBalancer"),
  "importReason.partOfAPIGateway": msg("importReason.partOfAPIGateway"),
  "importReason.partOfAnECSService": msg("importReason.partOfAnECSService"),
  "importReason.partOfEventHubs": msg("importReason.partOfEventHubs"),
  "importReason.partOfKeyVault": msg("importReason.partOfKeyVault"),
  "importReason.partOfTheCluster": msg("importReason.partOfTheCluster"),
  "importReason.shownThroughItsDatabases": msg("importReason.shownThroughItsDatabases"),
  "importReason.shownThroughItsEventHubs": msg("importReason.shownThroughItsEventHubs"),
  "importReason.shownThroughItsQueuesAndTopics": msg("importReason.shownThroughItsQueuesAndTopics"),
  "importReason.shownThroughItsServices": msg("importReason.shownThroughItsServices"),
  "importReason.terraformTypeNotDrawn": msg("importReason.terraformTypeNotDrawn"),
  "importReport.aclHosts": msg("importReport.aclHosts"),
  "importReport.aclWide": msg("importReport.aclWide"),
  "importReport.kafkaConnections": msg("importReport.kafkaConnections"),
  "importReport.more": msg("importReport.more"),
  "importReport.summary": msg("importReport.summary"),
  "importReport.unlisted": msg("importReport.unlisted"),
  "importReport.watchTraffic": msg("importReport.watchTraffic"),
};

/** Translate retained diagnostics only when presented, including nested reasons and lists. */
export function formatImportMessage(text: ImportText): string {
  if (typeof text === "string") return text;
  const resolve = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if ("code" in value) return formatImportMessage(value as ImportText);
    if ("list" in value) return formatList((value as { list: ImportText[] }).list.map(formatImportMessage));
    return Object.fromEntries(Object.entries(value).map(([key, arg]) => [key, resolve(arg)]));
  };
  const format = messages[text.code] as (...args: unknown[]) => string;
  return format(...text.args.map(resolve));
}

export const presentReportLine = (line: ReportLine) => ({
  name: formatImportMessage(line.name),
  reason: formatImportMessage(line.reason),
});
