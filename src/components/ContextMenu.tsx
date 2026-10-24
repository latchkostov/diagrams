import { t, useLocale } from "../i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MenuNode } from "../editor/actions";
import { useInteraction } from "../canvas/interaction/context";
import { createInteractionController, type PendingMenuInput } from "../canvas/interaction/controller";
import { createDomPort, domScheduler } from "../canvas/interaction/domPort";
import { defineLazySurface } from "../lib/lazySurface";
import { LoadingMenu } from "./LoadingMenu";

const MenuList = defineLazySurface<ListProps>({
  id: "canvas.menu",
  load: () => import("./MenuList").then((m) => m.default),
  placeholder: { render: (props, status) => <LoadingMenu {...props} status={status} /> },
  focus: {},
  export: "skip",
  retryToast: true,
});

// App context menu: keyboard navigable (arrows, Home/End, Enter, Esc, ←/→ for submenus),
// optional search-as-you-type, edge-aware placement. Submenus render as siblings in a fixed
// layer so nothing clips them. Closes on outside pointer-down, wheel, resize and window blur.

export interface Anchor {
  /** Physical canvas coordinates are left-aligned regardless of page direction. */
  alignment?: "physical-left";
  x: number;
  y: number;
  /** Submenus: where to put the menu's right edge if it doesn't fit to the right. */
  flipX?: number;
  minWidth?: number;
}

/** Why a menu closed: an item ran, Esc, a press outside it, the wheel, the window's focus or size changing. */
export type ContextMenuCloseReason = "pick" | "escape" | "outside" | "scroll" | "blur" | "resize";

export interface ContextMenuProps {
  alignment?: Anchor["alignment"];
  x: number;
  y: number;
  /** Where the menu's right edge goes when it doesn't fit right of `x` (it flips to the left). */
  flipX?: number;
  minWidth?: number;
  items: MenuNode[];
  onClose: (reason: ContextMenuCloseReason) => void;
  /** Root-level search box placeholder (quick-add, stencil picker). */
  searchable?: string;
  /** Accessible name. */
  label?: string;
  testId?: string;
  /** ID of the root menu, for its trigger's aria-controls. */
  menuId?: string;
  /** The trigger toggles its own menu instead of dismissing it on pointer-down. */
  triggerRef?: RefObject<HTMLElement | null>;
  /**
   * Gives focus back to what had it when the menu opened, if the menu's closing left it on the page (default). The
   * canvas's menus say false: its focus controller gives it back (src/canvas/interaction, rows M1 and M2).
   */
  returnFocus?: boolean;
}

export function ContextMenu({
  x,
  y,
  flipX,
  alignment,
  minWidth,
  items,
  onClose,
  searchable,
  label = t("chrome.contextMenu"),
  testId = "context-menu",
  menuId,
  triggerRef,
  returnFocus = true,
}: ContextMenuProps) {
  useLocale();
  const layer = useRef<HTMLDivElement>(null);
  const invoker = useRef(returnFocus && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const shared = useInteraction();
  const [controller] = useState(
    () => shared ?? createInteractionController(createDomPort({ root: () => null }), domScheduler),
  );
  const [pendingInput] = useState(() => controller.menuInput());
  useLayoutEffect(() => {
    const cancel = pendingInput.capture(
      () => document.activeElement === document.body || !!layer.current?.contains(document.activeElement),
      () => document.activeElement?.tagName !== "BUTTON",
      () => closeRef.current("escape"),
    );
    layer.current?.focus({ preventScroll: true });
    const focus = () => {
      if (!layer.current?.contains(document.activeElement)) pendingInput.cancel();
    };
    window.addEventListener("focusin", focus);
    return () => {
      cancel();
      window.removeEventListener("focusin", focus);
    };
  }, [pendingInput]);
  // The same anchor while the menu stays put: the list places itself whenever its anchor changes, so a new one on
  // every render moved a searchable menu that typing had shortened (from under the pointer: nightly #78).
  const anchor = useMemo(() => ({ x, y, flipX, alignment, minWidth }), [x, y, flipX, alignment, minWidth]);

  useEffect(() => {
    const previousFocus = invoker.current;
    const outside = (e: Event) => {
      if (e.type === "pointerdown" && triggerRef?.current?.contains(e.target as Node)) return;
      if (!layer.current?.contains(e.target as Node)) closeRef.current(e.type === "wheel" ? "scroll" : "outside");
    };
    const resized = () => closeRef.current("resize");
    const blurred = () => closeRef.current("blur");
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, { capture: true, passive: true });
    window.addEventListener("resize", resized);
    window.addEventListener("blur", blurred);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("resize", resized);
      window.removeEventListener("blur", blurred);
      // Actions and outside clicks may deliberately focus another control. Let them win.
      if (previousFocus)
        queueMicrotask(() => {
          if (document.activeElement === document.body && previousFocus.isConnected)
            previousFocus.focus({ preventScroll: true });
        });
    };
  }, [triggerRef]);

  return createPortal(
    <div ref={layer} tabIndex={-1} className="cm-layer" data-editor-overlay onContextMenu={(e) => e.preventDefault()}>
      <MenuList
        items={items}
        anchor={anchor}
        depth={0}
        searchable={searchable}
        pendingInput={pendingInput}
        focusOnMount
        activateFirst={false}
        onCloseAll={(reason) => closeRef.current(reason)}
        onBack={() => closeRef.current("escape")}
        label={label}
        testId={testId}
        menuId={menuId}
      />
    </div>,
    document.body,
  );
}

export interface ListProps {
  items: MenuNode[];
  anchor: Anchor;
  depth: number;
  searchable?: string;
  /** Ordered input belongs to the controller until the rows can take it. */
  pendingInput?: PendingMenuInput;
  focusOnMount: boolean;
  activateFirst: boolean;
  onCloseAll: (reason: "pick" | "escape") => void;
  onBack: () => void;
  label: string;
  testId: string;
  menuId?: string;
}
