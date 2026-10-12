import { lazy } from "react";

/** Password links are rare: their dialogs (and the strength hint) load the first time one is needed. */
export const PasswordLinkDialog = lazy(() =>
  import("./passwordDialogs").then((m) => ({ default: m.PasswordLinkDialog })),
);
export const UnlockDialog = lazy(() => import("./passwordDialogs").then((m) => ({ default: m.UnlockDialog })));
