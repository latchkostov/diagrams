import { t } from "../i18n/core";
import type { BrokerSpec } from "../model/brokers";

export function assignmentLabel(spec?: BrokerSpec) {
  switch (spec?.assignment) {
    case "shards":
      return t("broker.shards");
    case "subscriptions":
      return t("broker.subscriptions");
    case "bindings":
      return t("broker.bindings");
    default:
      return t("broker.partitions");
  }
}
export function groupLabel(spec?: BrokerSpec) {
  switch (spec?.group) {
    case "subscription":
      return t("broker.subscription");
    case "binding":
      return t("broker.binding");
    default:
      return t("broker.group");
  }
}
