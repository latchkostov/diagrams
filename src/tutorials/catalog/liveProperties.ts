import { t } from "../../i18n";
import type { Words } from "../types";

/** Keep the settings route in the learner's language while retaining the lesson's goal. */
export const livePropertiesGoal =
  (goal: Words): Words =>
  () =>
    t("workbench.liveEditGoal", {
      live: t("fileDialog.live"),
      properties: t("workbench.editProperties"),
      goal: goal(),
    });
