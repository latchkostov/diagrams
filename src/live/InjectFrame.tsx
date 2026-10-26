import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { dialogTabTarget, useInteraction, type MenuCloseReason } from "../canvas/interaction";
import type { InjectRequest } from "./InjectDialog";
import { t } from "../i18n";
import { openModalLayer } from "../lib/modalLayers";

export function InjectFrame({
  request,
  onClose,
  onSubmit,
  title,
  children,
  actions,
  first,
  loading = false,
}: {
  request: InjectRequest;
  onClose(): void;
  onSubmit?(): void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  first?: RefObject<HTMLElement | null>;
  loading?: boolean;
}) {
  const panel = useRef<HTMLFormElement>(null);
  const interaction = useInteraction();
  /** Why it closed (a pick, Esc, a press outside), for the focus return; `unmount` if it went any other way. */
  const reason = useRef<MenuCloseReason>("unmount");
  const closeWith = (why: MenuCloseReason) => {
    reason.current = why;
    onClose();
  };
  const close = useRef(closeWith);
  const port = useRef(interaction);
  useLayoutEffect(() => {
    close.current = closeWith;
    port.current = interaction;
  });
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // This node action returns to its originating node (D3). Sampling activeElement here raced the closing
    // context menu: it could be its removed item, the page, or the node its own cleanup had already focused.
    const background = Array.from(document.body.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !child.contains(el),
    );
    const previous = background.map((child) => child.inert);
    for (const child of background) child.inert = true;
    const closeLayer = openModalLayer(el);
    const target = first?.current ?? el.querySelector<HTMLElement>("button");
    if (target) port.current?.dispatch({ type: "dialog.opened", first: target });
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close.current("escape");
      }
      if (e.key !== "Tab") return;
      const target = dialogTabTarget(el, e.shiftKey);
      if (target) {
        e.preventDefault();
        port.current?.dispatch({ type: "dialog.tab", target });
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      closeLayer();
      el.removeEventListener("keydown", onKey);
      background.forEach((child, i) => {
        child.inert = previous[i];
      });
      if (!loading || reason.current !== "unmount")
        port.current?.dispatch({
          type: "dialog.closed",
          dialog: "inject",
          opener: null,
          node: request.nodeId,
          reason: reason.current,
        });
    };
  }, [request.nodeId, first, loading]);

  const left = Math.min(Math.max(12, request.x), window.innerWidth - 300);
  const top = Math.min(Math.max(12, request.y), window.innerHeight - 260);
  return createPortal(
    <div
      className="lv-modal-layer"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        closeWith("outside");
      }}
      onContextMenu={(e) => e.preventDefault()}
      data-editor-overlay
      data-testid="live-inject-backdrop"
    >
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-inject-title"
        tabIndex={-1}
        className="lv-inject"
        style={{ left, top }}
        onSubmit={(e) => {
          e.preventDefault();
          if (onSubmit) {
            onSubmit();
            closeWith("pick");
          }
        }}
        data-testid={loading ? "inject-loading" : "live-inject-dialog"}
      >
        <div className="lv-inject-title" id="live-inject-title">
          {title}
        </div>
        {children}
        <div className="lv-inject-actions">
          <button
            type="button"
            className="btn"
            onClick={() => closeWith("pick")}
            data-testid={loading ? "inject-loading-close" : "live-inject-cancel"}
          >
            {loading ? t("common.close") : t("common.cancel")}
          </button>
          {actions}
        </div>
      </form>
    </div>,
    document.body,
  );
}
