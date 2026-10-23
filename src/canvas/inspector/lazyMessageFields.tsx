import { lazyComponent } from "../../lib/lazyLoad";
import { t } from "../../i18n";

export const MessageFields = lazyComponent(
  () => import("./MessageFields").then((module) => module.MessageFields),
  (_, { failed }) =>
    failed ? null : (
      <p className="insp-note" role="status" data-testid="message-fields-loading">
        {t("common.loading")}
      </p>
    ),
  true,
);
