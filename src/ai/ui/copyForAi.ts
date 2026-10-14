import { t } from "../../i18n";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { isLocalOnly, privacyOf } from "../../lib/localOnly";
import { paletteHost } from "../../palette/host";
import { referenceText, resolveScope } from "./context";

/**
 * Copy for AI: the selected elements' ids and labels on the clipboard, to hand to an agent ("change
 * these"). Never for a local-only diagram.
 */
export async function copyForAi(ids: string[]): Promise<void> {
  const canvas = paletteHost.get().canvas;
  if (!canvas) return;
  if (isLocalOnly(canvas))
    return void notify(privacyOf(canvas) === "private" ? t("ai.privateOffPeriod") : t("ai.aIIsOffForThisLocalOnly2"), {
      kind: "error",
    });
  const diagram = canvas.editor.getDiagram();
  const scope = resolveScope(diagram, ids);
  if (!scope.length) return;
  const ok = await copyText(referenceText(diagram.title, scope));
  notify(
    ok
      ? scope.length === 1
        ? t("ai.copiedElement", { label: scope[0].label })
        : t("ai.copiedElements", { count: scope.length })
      : t("ai.theBrowserDidnTAllowCopyingTry"),
    { kind: ok ? "success" : "error" },
  );
}
