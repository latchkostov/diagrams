import { t, useLocale } from "../i18n";
import type { RoomRefusal } from "./room";

export function RoomRefusalNotice({ reason }: { reason: RoomRefusal }) {
  useLocale();
  const explanation = {
    "key-too-long": t("collab.refusedKey"),
    "string-too-long": t("collab.refusedText"),
    "too-deep": t("collab.refusedDepth"),
    "too-large": t("collab.refusedSize"),
    "bad-id": t("collab.refusedId"),
    "room-full": t("collab.refusedFull"),
    private: t("collab.leftPrivate"),
  }[reason];
  return (
    <p className="room-edit-alert" role="alert" data-testid="collab-edit-refused">
      {explanation}
    </p>
  );
}
