import { useMemo } from "react";
import type { EditorApi } from "../../editor/types";
import { paletteHost } from "../../palette/host";
import { encodeShare, shareUrl, SHARE_WARN_LENGTH } from "../../interop/share";
import { showApplied } from "../ui/feedback";
import { useWebMcp } from "./useWebMcp";
import type { WebMcpHost } from "./tools";

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

export default function WebMcpBridge({
  live,
  onNewDiagram,
}: {
  /** Live view or presenting: reading and sharing only. */
  live: boolean;
  onNewDiagram: () => void;
}) {
  const host = useMemo<WebMcpHost>(
    () => ({
      getEditor: currentEditor,
      onApplied: showApplied,
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
  useWebMcp(host, { enabled: true, live });
  return null;
}
