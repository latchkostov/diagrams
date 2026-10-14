import { lazyComponent, type Placeholder } from "../../lib/lazyLoad";
import { Dialog } from "./Dialog";
import { LINKS_OFF_MESSAGE } from "../../lib/deployment";
import { t } from "../../i18n";

// The import / export dialogs load the first time one opens, or earlier: when the File menu opens, or once
// the app is idle (preloadDialogs). None of them is part of the first view.

/**
 * A dialog's stand-in while its code downloads: the same modal frame, so the page behind is inert and Esc
 * or Close cancel it (the dialog then never appears), saying it's loading; or, if the download failed,
 * saying so with Retry.
 */
export function loadingDialog<P extends { onClose: () => void }>(title: string | (() => string)): Placeholder<P> {
  return ({ onClose }, { failed, retry }) => (
    <Dialog
      title={typeof title == "string" ? title : title()}
      testId="lazy-dialog"
      onClose={onClose}
      footer={
        failed && (
          <>
            <button className="btn" onClick={onClose} data-testid="lazy-dialog-cancel">
              {t("common.close")}
            </button>
            <button className="btn btn-primary" onClick={retry} data-testid="lazy-dialog-retry">
              {t("common.retry")}
            </button>
          </>
        )
      }
    >
      {failed ? (
        <p role="alert" data-testid="lazy-dialog-error">
          {t("fileDialog.loadFailed")}
        </p>
      ) : (
        <p role="status" className="ix-lazy-status" data-testid="lazy-dialog-loading">
          {t("common.loading")}
        </p>
      )}
    </Dialog>
  );
}

/**
 * The dialogs that make links, only in a copy deployed with share links (src/lib/deployment.ts's SHARE_LINKS).
 * Embed stays: without links it offers only the embed whose diagram the host's page supplies.
 * Read here as the build's literal, not through deployment.ts: the bundler drops a lazy import's code only when
 * its condition is a literal in the module that imports it, and an export only when the `import()` is read
 * directly (`import(…).then((m) => m.X)`, not through a helper) (src/lib/deployment.build.test.ts checks).
 */
declare const __DEPLOYMENT_SHARE_LINKS__: boolean;
const LINKS = __DEPLOYMENT_SHARE_LINKS__;
const linksOff = () => Promise.reject(new Error(LINKS_OFF_MESSAGE));

export const ShareDialog = lazyComponent(
  LINKS ? () => import("./dialogs").then((m) => m.ShareDialog) : linksOff,
  loadingDialog(() => t("fileDialog.shareLink")),
);
export const EmbedDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.EmbedDialog),
  loadingDialog(() => t("fileDialog.embedCode")),
);
/** File ▸ Share…: every way out, safest first; each of its rows opens one of the dialogs here, or saves the file. */
export const ShareChooserDialog = lazyComponent(
  () => import("./ShareChooser").then((m) => m.ShareChooser),
  loadingDialog(() => t("share.title")),
);
export const ImageDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.ImageDialog),
  loadingDialog(() => t("fileDialog.exportImage")),
);
export const PasteDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.PasteDialog),
  loadingDialog(() => t("fileDialog.pasteADiagram")),
);
export const OpenLinkDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.OpenLinkDialog),
  loadingDialog(() => t("fileDialog.openAShareLink")),
);
export const PagesDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.PagesDialog),
  loadingDialog(() => t("fileDialog.chooseAPage")),
);
export const PrivacyDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.PrivacyDialog),
  loadingDialog(() => t("privateDialog.title")),
);
export const ClearDeviceDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.ClearDeviceDialog),
  loadingDialog(() => t("clear.loadingTitle")),
);
/** File ▸ Export as ▸ Interactive HTML… (src/export): the template itself downloads only when it opens. */
export const HtmlExportDialog = lazyComponent(
  () => import("../../export/HtmlExportDialog").then((m) => m.HtmlExportDialog),
  loadingDialog(() => t("htmlExport.interactiveHTML")),
);
/** Password links: the dialogs and the strength hint. */
export const PasswordLinkDialog = lazyComponent(
  LINKS ? () => import("./passwordDialogs").then((m) => m.PasswordLinkDialog) : linksOff,
  loadingDialog(() => t("passwordLink.linkWithPassword")),
);
export const UnlockDialog = lazyComponent(
  () => import("./passwordDialogs").then((m) => m.UnlockDialog),
  loadingDialog(() => t("passwordLink.thisDiagramIsPasswordprotected")),
);
/** The Import report: with the first infrastructure import (it brings the stencil search and the AI swap). */
export const ImportReportDialog = lazyComponent(
  () => import("./ImportReportDialog").then((m) => m.ImportReportDialog),
  loadingDialog(() => t("importReport.importReport")),
);
/** Only cloud providers use the in-app file list, so it loads with the first one opened. */
export const StorageFilesDialog = lazyComponent(
  () => import("./StorageDialog").then((m) => m.StorageFilesDialog),
  (props, status) => loadingDialog<typeof props>(props.label)(props, status),
);

/** Warms every dialog the File menu and the canvas's Export menu can open. */
export function preloadDialogs() {
  for (const dialog of [
    ShareChooserDialog,
    ...(LINKS ? [ShareDialog, PasswordLinkDialog] : []),
    EmbedDialog,
    ImageDialog,
    PasteDialog,
    OpenLinkDialog,
    PagesDialog,
    PrivacyDialog,
    HtmlExportDialog,
  ])
    dialog.preload();
}
