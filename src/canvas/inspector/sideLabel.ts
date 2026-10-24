import { t } from "../../i18n";
import type { Side } from "../../model/types";

export function sideLabel(side?: Side) {
  return side === undefined
    ? t("inspector.auto")
    : {
        top: t("inspector.sideTop"),
        bottom: t("inspector.sideBottom"),
        left: t("inspector.sideLeft"),
        right: t("inspector.sideRight"),
      }[side];
}
