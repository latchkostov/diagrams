import { useEffect, useState } from "react";
import { t, useLocale } from "../i18n";
import { Dialog } from "../interop/ui/Dialog";
import { authorizeError, authorizeInPopup } from "../interop/storage/oauth";
import { graphError } from "../interop/storage/onedrive";

/** The real cloud error paths, with an injected blocked popup and provider replies; no account or network. */
export function FilePrompts({ scenario }: { scenario: string }) {
  useLocale();
  const [blocked, setBlocked] = useState<string>();
  useEffect(() => {
    let live = true;
    void authorizeInPopup("OneDrive", () => "", {
      open: () => null,
      listen: () => () => {},
      hasFocus: () => true,
    }).catch((err: unknown) => {
      if (live && err instanceof Error) setBlocked(err.message);
    });
    return () => {
      live = false;
    };
  }, []);
  const message =
    scenario === "blocked"
      ? (blocked ?? t("common.loading"))
      : scenario === "admin"
        ? authorizeError("OneDrive", "interaction_required", "AADSTS90094")
        : scenario === "denied"
          ? authorizeError("OneDrive", "access_denied")
          : graphError(scenario === "full" ? 507 : 401, "", "download the file");
  const [open, setOpen] = useState(true);
  return open ? (
    <Dialog
      title={t("storageDialog.title", { provider: "OneDrive" })}
      onClose={() => setOpen(false)}
      testId="file-prompts-dialog"
    >
      <p role="alert" data-testid="file-prompts-message">
        {message}
      </p>
    </Dialog>
  ) : (
    <button className="btn" onClick={() => setOpen(true)} data-testid="file-prompts-open">
      {t("file.open")}
    </button>
  );
}
