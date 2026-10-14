import { t } from "../../i18n";
import type { CloudOperation } from "./types";

export const cloudNetwork = (label: string, action: CloudOperation) =>
  t("cloud.couldntReachLabelToActionCheckYour", { label, action });
export const cloudMessages = {
  expired: (provider: string, action: CloudOperation) => t("cloud.signInExpired", { provider, action }),
  changed: (provider: string, action: CloudOperation) => t("cloud.fileChanged", { provider, action }),
  busy: (provider: string, status: number) => t("cloud.busy", { provider, status }),
  full: (provider: string) => t("cloud.storageFull", { provider }),
  missing: (provider: string) => t("cloud.fileMissing", { provider }),
  failed: (provider: string, action: CloudOperation, status: number, detail: string) =>
    t("cloud.operationFailed", { provider, value0: action, value1: status, value2: detail }),
};
