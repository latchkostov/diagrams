import { lazyComponent, LOAD_FAILED, type Placeholder } from "../../lib/lazyLoad";
import { Dialog } from "./Dialog";
import { LINKS_OFF_MESSAGE } from "../../lib/deployment";

// The import / export dialogs load the first time one opens, or earlier: when the File menu opens, or once
// the app is idle (preloadDialogs). None of them is part of the first view.

/**
 * A dialog's stand-in while its code downloads: the same modal frame, so the page behind is inert and Esc
 * or Close cancel it (the dialog then never appears), saying it's loading; or, if the download failed,
 * saying so with Retry.
 */
export function loadingDialog<P extends { onClose: () => void }>(title: string): Placeholder<P> {
  return ({ onClose }, { failed, retry }) => (
    <Dialog
      title={title}
      testId="lazy-dialog"
      onClose={onClose}
      footer={
        failed && (
          <>
            <button className="btn" onClick={onClose} data-testid="lazy-dialog-cancel">
              Close
            </button>
            <button className="btn btn-primary" onClick={retry} data-testid="lazy-dialog-retry">
              Retry
            </button>
          </>
        )
      }
    >
      {failed ? (
        <p role="alert" data-testid="lazy-dialog-error">
          {LOAD_FAILED}
        </p>
      ) : (
        <p role="status" className="ix-lazy-status" data-testid="lazy-dialog-loading">
          Loading…
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
  loadingDialog("Share link"),
);
export const EmbedDialog = lazyComponent(() => import("./dialogs").then((m) => m.EmbedDialog), loadingDialog("Embed"));
export const ImageDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.ImageDialog),
  loadingDialog("Export image"),
);
export const PasteDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.PasteDialog),
  loadingDialog("Paste a diagram"),
);
export const OpenLinkDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.OpenLinkDialog),
  loadingDialog("Open a share link"),
);
export const PagesDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.PagesDialog),
  loadingDialog("Choose a page"),
);
export const PrivacyDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.PrivacyDialog),
  loadingDialog("Private diagram"),
);
export const ClearDeviceDialog = lazyComponent(
  () => import("./dialogs").then((m) => m.ClearDeviceDialog),
  loadingDialog("Clear everything"),
);
/** File ▸ Export as ▸ Interactive HTML… (src/export): the template itself downloads only when it opens. */
export const HtmlExportDialog = lazyComponent(
  () => import("../../export/HtmlExportDialog").then((m) => m.HtmlExportDialog),
  loadingDialog("Interactive HTML"),
);
/** Password links: the dialogs and the strength hint. */
export const PasswordLinkDialog = lazyComponent(
  LINKS ? () => import("./passwordDialogs").then((m) => m.PasswordLinkDialog) : linksOff,
  loadingDialog("Copy link with password"),
);
export const UnlockDialog = lazyComponent(
  () => import("./passwordDialogs").then((m) => m.UnlockDialog),
  loadingDialog("This diagram is password-protected"),
);
/** The Import report: with the first infrastructure import (it brings the stencil search and the AI swap). */
export const ImportReportDialog = lazyComponent(
  () => import("./ImportReportDialog").then((m) => m.ImportReportDialog),
  loadingDialog("Import report"),
);
/** Only cloud providers use the in-app file list, so it loads with the first one opened. */
export const StorageFilesDialog = lazyComponent(
  () => import("./StorageDialog").then((m) => m.StorageFilesDialog),
  (props, status) => loadingDialog<typeof props>(props.label)(props, status),
);

/** Warms every dialog the File menu and the canvas's Export menu can open. */
export function preloadDialogs() {
  for (const dialog of [
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
