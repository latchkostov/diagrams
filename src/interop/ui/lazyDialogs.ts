import { lazyComponent } from "../../lib/lazyLoad";

// The import / export dialogs load the first time one opens, or earlier: when the File menu opens, or once
// the app is idle (preloadDialogs). None of them is part of the first view.

const dialogs = () => import("./dialogs");
const passwordDialogs = () => import("./passwordDialogs");

export const ShareDialog = lazyComponent(() => dialogs().then((m) => m.ShareDialog));
export const EmbedDialog = lazyComponent(() => dialogs().then((m) => m.EmbedDialog));
export const ImageDialog = lazyComponent(() => dialogs().then((m) => m.ImageDialog));
export const PasteDialog = lazyComponent(() => dialogs().then((m) => m.PasteDialog));
export const OpenLinkDialog = lazyComponent(() => dialogs().then((m) => m.OpenLinkDialog));
export const PagesDialog = lazyComponent(() => dialogs().then((m) => m.PagesDialog));
export const PrivacyDialog = lazyComponent(() => dialogs().then((m) => m.PrivacyDialog));
/** Password links: the dialogs and the strength hint. */
export const PasswordLinkDialog = lazyComponent(() => passwordDialogs().then((m) => m.PasswordLinkDialog));
export const UnlockDialog = lazyComponent(() => passwordDialogs().then((m) => m.UnlockDialog));
/** Only cloud providers use the in-app file list, so it loads with the first one opened. */
export const StorageFilesDialog = lazyComponent(() => import("./StorageDialog").then((m) => m.StorageFilesDialog));

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
