import { useMemo, useSyncExternalStore } from "react";
import type { EditorApi } from "../../editor/types";
import { paletteHost } from "../../palette/host";
import { encodeShare, shareUrl, SHARE_WARN_LENGTH } from "../../interop/share";
import { panelShown, showApplied } from "../ui/feedback";
import { useWebMcp } from "./useWebMcp";
import type { AgentChange, WebMcpHost } from "./tools";
import { threads } from "../ui/threadStore";
import { unseen } from "../ui/unseen";
import { isLocalOnly } from "../../lib/localOnly";

// Lazy-loaded by AiMount, only in the editor view and only when the browser has WebMCP. Renders nothing.

const currentEditor = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

/** Resolves with the editor of the diagram that opens after `start` (or the current one after a while). */
function nextEditor(previous: EditorApi | null, timeoutMs = 4000): Promise<EditorApi | null> {
  return new Promise((resolve) => {
    const check = () => {
      const e = currentEditor();
      if (e && e !== previous) {
        off();
        clearTimeout(timer);
        resolve(e);
      }
    };
    const off = paletteHost.subscribe(check);
    const timer = setTimeout(() => {
      off();
      resolve(currentEditor());
    }, timeoutMs);
  });
}

/**
 * An agent's change: the highlight, and a turn in this diagram's AI panel thread (with Undo this change
 * bound to its history step, and Revert to here). With the panel folded, a toast with Undo too, and a
 * count on the rail; the panel never opens by itself.
 */
function recordChange(change: AgentChange): void {
  if (change.historyKey) showApplied(change.summary, change.changed, change.editor);
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
    ...(change.historyKey ? { after: change.editor.getDiagram(), historyKey: change.historyKey } : {}),
    engine: "agent",
    tool: change.tool,
  });
}

export default function WebMcpBridge({
  live,
  onNewDiagram,
}: {
  /** Live view or presenting: reading and sharing only. */
  live: boolean;
  onNewDiagram: () => void;
}) {
  const canvas = useSyncExternalStore(paletteHost.subscribe, paletteHost.get).canvas;
  const host = useMemo<WebMcpHost>(
    () => ({
      getEditor: currentEditor,
      canUseAi: () => !isLocalOnly(paletteHost.get().canvas),
      onApplied: recordChange,
      async newDiagram({ title, direction }) {
        const before = currentEditor();
        const opened = nextEditor(before);
        onNewDiagram();
        const editor = await opened;
        if (!editor || !(title || direction)) return editor;
        editor.updateMeta({ ...(title ? { title } : {}), ...(direction ? { direction } : {}) });
        // The edit lands on the next render (and may promote the draft into Your diagrams).
        await new Promise((r) => setTimeout(r, 60));
        return currentEditor() ?? editor;
      },
      async shareLink(diagram) {
        const url = shareUrl(await encodeShare(diagram));
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
  useWebMcp(host, { enabled: !!canvas && !isLocalOnly(canvas), live });
  return null;
}
