import { useEffect, useLayoutEffect, useRef } from "react";
import { getModelContext, registerTools } from "./adapter";
import { buildTools, EDIT_TOOLS, LIVE_TOOLS, type WebMcpHost } from "./tools";

/**
 * Offers the diagram's tools to browsing agents through WebMCP (decision 9). Feature-detected: with
 * no `document.modelContext` nothing registers, nothing errors and nothing shows.
 *
 * Registration lives in an effect with an AbortController: unmounting (or a StrictMode double
 * mount, or switching to live view) aborts, which unregisters every tool. `live` reduces the set
 * to reading, checking and sharing.
 */
export function useWebMcp(host: WebMcpHost, opts: { enabled: boolean; live: boolean }): void {
  const hostRef = useRef(host);
  useLayoutEffect(() => {
    hostRef.current = host;
  });
  const { enabled, live } = opts;
  useEffect(() => {
    if (!enabled) return;
    const ctx = getModelContext();
    if (!ctx) return;
    const controller = new AbortController();
    // Tools read the host through the ref, so a new editor (another diagram) needs no re-register.
    const proxy: WebMcpHost = {
      getEditor: () => hostRef.current.getEditor(),
      canUseAi: () => hostRef.current.canUseAi?.() !== false,
      onApplied: (...a) => hostRef.current.onApplied(...a),
      newDiagram: (o) => hostRef.current.newDiagram(o),
      shareLink: (d) => hostRef.current.shareLink(d),
    };
    void registerTools(ctx, buildTools(proxy, live ? LIVE_TOOLS : EDIT_TOOLS), controller.signal);
    return () => controller.abort();
  }, [enabled, live]);
}
