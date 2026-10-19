import { t } from "../../i18n";
import { notify, toast } from "../../interop/ui/toast";
import type { WatchNotices } from "./watch";

/** What Watch together tells this person: the offer of a run to watch (a toast), and what became of following. */
export const watchNotices: WatchNotices = {
  offer: (show, run) =>
    toast.info(t("collab.watchOffer", show), {
      duration: 15_000,
      action: { label: t("collab.watch"), run, testId: "room-watch-offer" },
    }),
  told: (message, alias) =>
    notify(
      message === "own"
        ? t("collab.watchingOwn")
        : message === "version"
          ? t("collab.versionDiffers", { alias })
          : message === "too-large"
            ? t("collab.watchTooLarge")
            : t("collab.cantFollow"),
      { kind: message === "own" ? "info" : "error" },
    ),
};
