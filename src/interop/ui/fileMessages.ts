import { formatBytes } from "../../i18n/format";
import { LIMITS } from "../native";
import { t } from "../../i18n";

/** Failure text loads only after an operation fails; pickers still open directly from the gesture. */
export type FileFailureAction = string | { action: "saveProvider" | "openProvider" | "image"; name: string };
export function fileFailure(action: FileFailureAction, error: string): string {
  if (typeof action === "string") return t("fileToast.failed", { action, error });
  const { name } = action;
  switch (action.action) {
    case "saveProvider":
      return t("fileToast.providerSaveFailed", { provider: name, error });
    case "openProvider":
      return t("fileToast.providerOpenFailed", { provider: name, error });
    case "image":
      return t("fileToast.imageFailed", { format: name, error });
  }
}

export const nativeExported = (nodes: number, edges: number) =>
  t("fileToast.exportedNodesPluralOneNodeOtherNodes", { nodes, edges });

export const importedFile = (title: string, format: string, warnings: string[]) =>
  t("fileToast.imported", { title, format, warning: warnings[0] || "none", more: Math.max(0, warnings.length - 1) });

export const downloadedFile = (name: string) => t("fileToast.downloadedNameThisBrowserCantSaveOver", { name });

export function deviceSaved(name: string, title: string, bound: boolean, stillOpen: boolean): string {
  return bound && stillOpen
    ? t("fileToast.savedToValue0CtrlSSavesHereAgain", { value0: name })
    : bound
      ? t("fileToast.savedValue0ToValue1CtrlSSavesIt", { value0: title, value1: name })
      : t("fileToast.savedValue0ToValue1TheOpenDiagram", { value0: title, value1: name });
}

export const libraryDeleted = (title: string) => t("library.deleted", { title });
export const libraryDuplicated = (title: string) => t("library.duplicated", { title });
export const libraryFailure = (action: string, error: string) => t("library.failed", { action, error });
export const libraryStorageFull = () => t("library.storageFull");
export const libraryRestoreFull = () => t("library.restoreFull");

export const importTooLarge = (name: string, bytes: number) =>
  t("fileToast.tooLarge", {
    name,
    size: formatBytes(bytes, { unit: "megabyte", minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    limit: formatBytes(LIMITS.maxTextChars, { unit: "megabyte", minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  });

export { formatImportMessage } from "./importMessages";
