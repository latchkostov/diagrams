import { lazy } from "react";

/** Only cloud providers use the in-app file list, so it loads with the first one opened. */
export const StorageFilesDialog = lazy(() =>
  import("./StorageDialog").then((m) => ({ default: m.StorageFilesDialog })),
);
