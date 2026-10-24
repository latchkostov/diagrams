import { defineLazySurface } from "../../lib/lazySurface";
import { t } from "../../i18n";

export const MessageFields = defineLazySurface({
  id: "inspector.messages",
  load: () => import("./MessageFields").then((module) => module.MessageFields),
  placeholder: {
    size: {},
    testId: "inspector.messages-loading",
    render: (_, { failed }) =>
      failed ? null : (
        <p className="insp-note" role="status" data-testid="message-fields-loading">
          {t("common.loading")}
        </p>
      ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
