import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { isLocalOnly, privacyOf, PRIVATE_AI_OFF } from "../../lib/localOnly";
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
    return void notify(
      privacyOf(canvas) === "private" ? `${PRIVATE_AI_OFF}.` : "AI is off for this local-only diagram.",
      {
        kind: "error",
      },
    );
  const diagram = canvas.editor.getDiagram();
  const scope = resolveScope(diagram, ids);
  if (!scope.length) return;
  const ok = await copyText(referenceText(diagram.title, scope));
  notify(
    ok
      ? `Copied ${scope.length === 1 ? `“${scope[0].label}”` : `${scope.length} elements`} for your AI. Paste it into your request.`
      : "The browser didn't allow copying. Try again.",
    { kind: ok ? "success" : "error" },
  );
}
