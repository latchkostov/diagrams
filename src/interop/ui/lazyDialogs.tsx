import { lazyComponent, LOAD_FAILED, type Placeholder } from "../../lib/lazyLoad";
import { Dialog } from "./Dialog";

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

const dialogs = () => import("./dialogs");
const passwordDialogs = () => import("./passwordDialogs");

export const ShareDialog = lazyComponent(() => dialogs().then((m) => m.ShareDialog), loadingDialog("Share link"));
export const EmbedDialog = lazyComponent(() => dialogs().then((m) => m.EmbedDialog), loadingDialog("Embed"));
export const ImageDialog = lazyComponent(() => dialogs().then((m) => m.ImageDialog), loadingDialog("Export image"));
export const PasteDialog = lazyComponent(() => dialogs().then((m) => m.PasteDialog), loadingDialog("Paste a diagram"));
export const OpenLinkDialog = lazyComponent(
  () => dialogs().then((m) => m.OpenLinkDialog),
  loadingDialog("Open a share link"),
);
export const PagesDialog = lazyComponent(() => dialogs().then((m) => m.PagesDialog), loadingDialog("Choose a page"));
export const PrivacyDialog = lazyComponent(
  () => dialogs().then((m) => m.PrivacyDialog),
  loadingDialog("Private diagram"),
);
/** Password links: the dialogs and the strength hint. */
export const PasswordLinkDialog = lazyComponent(
  () => passwordDialogs().then((m) => m.PasswordLinkDialog),
  loadingDialog("Copy link with password"),
);
export const UnlockDialog = lazyComponent(
  () => passwordDialogs().then((m) => m.UnlockDialog),
  loadingDialog("This diagram is password-protected"),
);
/** Only cloud providers use the in-app file list, so it loads with the first one opened. */
export const StorageFilesDialog = lazyComponent(
  () => import("./StorageDialog").then((m) => m.StorageFilesDialog),
  (props, status) => loadingDialog<typeof props>(props.label)(props, status),
);

/** Warms every dialog the File menu and the canvas's Export menu can open. */
export function preloadDialogs() {
  for (const dialog of [
    ShareDialog,
    EmbedDialog,
    ImageDialog,
    PasteDialog,
    OpenLinkDialog,
    PagesDialog,
    PrivacyDialog,
    PasswordLinkDialog,
  ])
    dialog.preload();
}
