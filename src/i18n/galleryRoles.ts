import { t } from "./index";
import { simRoleMeta } from "../lib/simRoles";
import type { SimRole } from "../model/types";

/** Display metadata for simulation roles. The hue is reused later for the live-view legend. */
export const galleryRoleMeta: Record<SimRole, { label: string; hue: string; hint: string }> = {
  source: {
    get label() {
      return t("gallery.source");
    },
    hue: simRoleMeta.source.hue,
    get hint() {
      return t("gallery.emitsMessages");
    },
  },
  topic: {
    get label() {
      return t("gallery.topic");
    },
    hue: simRoleMeta.topic.hue,
    get hint() {
      return t("gallery.pubSubEverySubscriberGetsACopy");
    },
  },
  queue: {
    get label() {
      return t("gallery.queue");
    },
    hue: simRoleMeta.queue.hue,
    get hint() {
      return t("gallery.pointToPointOneConsumerPerMessage");
    },
  },
  stream: {
    get label() {
      return t("gallery.stream");
    },
    hue: simRoleMeta.stream.hue,
    get hint() {
      return t("gallery.orderedPartitionedLog");
    },
  },
  processor: {
    get label() {
      return t("gallery.processor");
    },
    hue: simRoleMeta.processor.hue,
    get hint() {
      return t("gallery.receivesTransformsForwards");
    },
  },
  gateway: {
    get label() {
      return t("gallery.gateway");
    },
    hue: simRoleMeta.gateway.hue,
    get hint() {
      return t("gallery.routesOrPassesRequestsThrough");
    },
  },
  store: {
    get label() {
      return t("gallery.store");
    },
    hue: simRoleMeta.store.hue,
    get hint() {
      return t("gallery.persistsData");
    },
  },
  sink: {
    get label() {
      return t("gallery.sink");
    },
    hue: simRoleMeta.sink.hue,
    get hint() {
      return t("gallery.terminalConsumer");
    },
  },
  none: {
    get label() {
      return t("gallery.decorative");
    },
    hue: simRoleMeta.none.hue,
    get hint() {
      return t("gallery.notPartOfTheFlow");
    },
  },
};
