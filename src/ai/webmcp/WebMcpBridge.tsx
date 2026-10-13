import { useMemo, useSyncExternalStore } from "react";
import type { EditorApi } from "../../editor/types";
import { paletteHost } from "../../palette/host";
import { encodeShare, shareUrl, SHARE_WARN_LENGTH } from "../../interop/share";
import { panelShown, showApplied } from "../ui/feedback";
import { useWebMcp } from "./useWebMcp";
import { openNewDiagram } from "./newDiagram";
import type { AgentChange, WebMcpHost } from "./tools";
import { threads } from "../ui/threadStore";
import { unseen } from "../ui/unseen";
import { canShareAsLink, canUseAiTools, PRIVATE_SHARE_MESSAGE } from "../../lib/localOnly";
import { LINKS_OFF_MESSAGE, SHARE_LINKS } from "../../lib/deployment";

// Lazy-loaded by AiMount, only in the editor view and only when the browser has WebMCP. Renders nothing.

const currentEditor = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

/**
 * An agent's change: the highlight, and a turn in this diagram's AI panel thread (with Undo this change
 * bound to its history step, and Revert to here). With the panel folded, a toast with Undo too, and a
 * count on the rail; the panel never opens by itself.
 */
function recordChange(change: AgentChange): void {
  // An agent never moves the person's view. new_diagram has no step to undo, so no toast.
  if (change.historyKey) showApplied(change.summary, change.changed, change.editor, { turnUndo: true, reveal: false });
  const documentId = paletteHost.get().canvas?.documentId;
  if (!documentId) return;
  if (!panelShown()) unseen.bump(documentId);
  threads.append(documentId, {
    kind: "change",
    request: "",
    ...(change.note ? { reply: change.note } : {}),
    summary: change.summary,
    changed: change.changed,
    ...(change.choices ? { choices: change.choices } : {}),
    ...(change.warnings ? { warnings: change.warnings } : {}),
    // The snapshot (for Revert to here) is kept whether or not the change is an undo step (new_diagram isn't).
    after: change.editor.getDiagram(),
    ...(change.historyKey ? { historyKey: change.historyKey } : {}),
    engine: "agent",
    tool: change.tool,
  });
}

export default function WebMcpBridge({
  live,
  onNewDiagram,
}: {
  /** Live view or presenting: reading, checking and sharing only. */
  live: boolean;
  onNewDiagram: () => void;
}) {
  const canvas = useSyncExternalStore(paletteHost.subscribe, paletteHost.get).canvas;
  const host = useMemo<WebMcpHost>(
    () => ({
      getEditor: currentEditor,
      canUseAi: () => canUseAiTools(paletteHost.get().canvas),
      documentId: () => paletteHost.get().canvas?.documentId,
      onApplied: recordChange,
      newDiagram: (meta) =>
        openNewDiagram(
          {
            currentEditor,
            canUseAi: () => canUseAiTools(paletteHost.get().canvas),
            documentId: () => paletteHost.get().canvas?.documentId,
            subscribe: paletteHost.subscribe,
            open: onNewDiagram,
            settle: () => new Promise((r) => setTimeout(r, 60)),
          },
          meta,
        ),
      async shareLink(diagram) {
        // Never published without share links (./toolList.ts); folded at build time, so no encoder ships.
        if (!SHARE_LINKS) throw new Error(LINKS_OFF_MESSAGE);
        const canvas = paletteHost.get().canvas;
        if (!canShareAsLink(canvas)) throw new Error(PRIVATE_SHARE_MESSAGE);
        const url = shareUrl(await encodeShare(diagram));
        // Encoding takes a moment: the same document may have become private (or been replaced) meanwhile.
        const now = paletteHost.get().canvas;
        if (!now || now.documentId !== canvas?.documentId || !canShareAsLink(now))
          throw new Error(PRIVATE_SHARE_MESSAGE);
        return {
          url,
          length: url.length,
          ...(url.length > SHARE_WARN_LENGTH
            ? { warning: `The link is ${url.length} characters; some apps cut long links. Export a file instead.` }
            : {}),
        };
      },
    }),
    [onNewDiagram],
  );
  useWebMcp(host, { enabled: !!canvas && canUseAiTools(canvas), live });
  return null;
}
