import { installPurgeAnnouncement } from "./cachePurgeBridge";
import { t } from "../i18n";
import type { Fault } from "../model/faults";
import type { CacheTable } from "../model/caching";
import type { LiveController } from "./controller";
import { isolate } from "./bidi";

/** Completion copy loads with the cache surface, outside the Live session reserve. */
export function announcePurge(
  c: LiveController,
  fault: Extract<Fault, { kind: "purge" }>,
  announce?: (text: string) => void,
) {
  const table = c.effectiveProps(fault.node).cache as CacheTable;
  const rule =
    fault.rule === undefined
      ? t("cache.allRules")
      : fault.rule === ""
        ? t("cache.everythingElse")
        : table.rules.find((r) => r.id === fault.rule)?.label || fault.rule;
  announce?.(
    t("fault.marker", {
      action: t("cache.purged", {
        name: isolate(c.currentDiagram.nodes.find((n) => n.id === fault.node)?.label || fault.node),
      }),
      target: t("fault.marker", {
        action:
          fault.reason === "deploy"
            ? t("cache.deploy")
            : fault.mode === "soft"
              ? t("cache.softPurge")
              : t("cache.hardPurge"),
        target: isolate(rule),
      }),
    }),
  );
}

installPurgeAnnouncement(announcePurge);
