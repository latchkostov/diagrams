import { t } from "./index";
import type { SimRole } from "../model/types";

/** Display metadata for simulation roles. The hue is reused later for the live-view legend. */
export const galleryRoleMeta: Record<SimRole, { label: string; hue: string; hint: string }> = {
  source: {
    get label() {
      return t("gallery.source");
    },
    hue: "#22a06b",
    get hint() {
      return t("gallery.emitsMessages");
    },
  },
  topic: {
    get label() {
      return t("gallery.topic");
    },
    hue: "#8b5cf6",
    get hint() {
      return t("gallery.pubSubEverySubscriberGetsACopy");
    },
  },
  queue: {
    get label() {
      return t("gallery.queue");
    },
    hue: "#e5a00d",
    get hint() {
      return t("gallery.pointToPointOneConsumerPerMessage");
    },
  },
  stream: {
    get label() {
      return t("gallery.stream");
    },
    hue: "#0ea5b7",
    get hint() {
      return t("gallery.orderedPartitionedLog");
    },
  },
  processor: {
    get label() {
      return t("gallery.processor");
    },
    hue: "#3b82f6",
    get hint() {
      return t("gallery.receivesTransformsForwards");
    },
  },
  gateway: {
    get label() {
      return t("gallery.gateway");
    },
    hue: "#14b8a6",
    get hint() {
      return t("gallery.routesOrPassesRequestsThrough");
    },
  },
  store: {
    get label() {
      return t("gallery.store");
    },
    hue: "#a1785c",
    get hint() {
      return t("gallery.persistsData");
    },
  },
  sink: {
    get label() {
      return t("gallery.sink");
    },
    hue: "#e5484d",
    get hint() {
      return t("gallery.terminalConsumer");
    },
  },
  none: {
    get label() {
      return t("gallery.decorative");
    },
    hue: "#8a94a6",
    get hint() {
      return t("gallery.notPartOfTheFlow");
    },
  },
};
