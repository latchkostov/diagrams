import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";
import { calloutOffset } from "./calloutPlacement";
import { hoverTop, hoverRoom } from "./hoverPlacement";
import { observeProtectedControls, protectedControls } from "./protectedControls";
import { HoverStatus, HoverVerdict, HoverVitals, SectionRows } from "./HoverReadout";
import type { HoverFact, HoverSummary } from "./hoverSummary";

export interface HoverCardProps {
  kind: "node" | "edge";
  id: string;
  name: string;
  type: string;
  pinned: boolean;
  focusClaim?: () => boolean;
  presenting: boolean;
  summary: HoverSummary;
  healthy: string;
  children(section: string): ReactNode;
}

/** Screen-space frame and recovery UI stay outside deferred detail chunks. */
export function HoverCard({
  kind,
  id,
  name,
  type,
  pinned,
  focusClaim,
  presenting,
  summary,
  healthy,
  children,
}: HoverCardProps) {
  const interaction = useInteraction()!;
  const ref = useRef<HTMLDivElement>(null);
  const domNode = useStore((s) => s.domNode);
  const transform = useStore((s) => s.transform);
  const [open, setOpen] = useState<string | null>(null);
  // Opaque DOM ids: an imported item id may hold any UTF-16 (an unpaired surrogate can't be URI-encoded).
  const uid = useId();
  const cardId = `${uid}card`,
    descriptionId = `${uid}description`;
  const problem = summary.problems[0];
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !domNode) return;
    const anchor = domNode.querySelector<HTMLElement>(`[data-testid="${kind}-${CSS.escape(id)}"]`);
    if (!anchor) return;
    const wrap = domNode.closest('[data-testid="canvas-wrap"]') ?? domNode;
    // Callouts, the bar, the Inspector and a waiting narration (its Continue) stay actionable.
    const place = () => {
      const bounds = domNode.getBoundingClientRect();
      const overlays = document.querySelectorAll<HTMLElement>('[data-testid="live-controls"]');
      const bottom = Math.min(bounds.bottom, ...Array.from(overlays).map((el) => el.getBoundingClientRect().top - 8));
      const scale = presenting ? 1.3 : 1;
      card.style.setProperty("--hover-scale", String(scale));
      const room = `${Math.max(80, bottom - bounds.top - 24) / scale}px`;
      card.style.setProperty("--hover-room", room);
      card.style.maxHeight = room;
      card.style.maxWidth = `${Math.max(80, bounds.width - 24) / scale}px`;
      const rect = anchor.getBoundingClientRect();
      const size = card.getBoundingClientRect();
      let left = rect.left;
      // A fixed-height summary goes beside the node when neither vertical gap can hold it.
      if (size.height > hoverRoom({ top: bounds.top, bottom }, rect)) {
        if (rect.right + size.width + 24 <= bounds.right) left = rect.right + 12;
        else if (rect.left - size.width - 24 >= bounds.left) left = rect.left - size.width - 12;
      }
      left = Math.max(bounds.left + 12, Math.min(left, bounds.right - size.width - 12));
      const top = hoverTop({ top: bounds.top, bottom }, rect, size.height);
      const obstacles = [...wrap.querySelectorAll<HTMLElement>(protectedControls)].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height };
      });
      // A displaced card must still leave its originating node/connection actionable.
      obstacles.push({ x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height });
      if (kind === "node") {
        const badges = domNode.querySelector(`[data-testid="node-badge-${CSS.escape(id)}"]`);
        for (const badge of badges?.querySelectorAll<HTMLElement>(".lv-metric,.lv-alert") ?? []) {
          if (getComputedStyle(badge).visibility === "hidden") continue;
          const r = badge.getBoundingClientRect();
          obstacles.push({ x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height });
        }
      }
      let offset = calloutOffset(
        { x: left - bounds.left, y: top - bounds.top, width: size.width, height: size.height },
        { width: bounds.width, height: bottom - bounds.top },
        obstacles,
      );
      if (!offset) {
        // Expanded details can scroll when overlays leave no full-height slot.
        card.style.maxHeight = `${Math.max(80, (bottom - bounds.top - 24) / scale / 2)}px`;
        const compact = card.getBoundingClientRect();
        offset = calloutOffset(
          { x: left - bounds.left, y: top - bounds.top, width: compact.width, height: compact.height },
          { width: bounds.width, height: bottom - bounds.top },
          obstacles,
        );
      }
      // A hover summary never obscures an action, even in a pane with no free slot. A pinned card was asked for and
      // may hold focus: it stays readable (its compact height scrolls) until Esc or a click elsewhere closes it.
      card.style.visibility = offset || pinned ? "" : "hidden";
      card.style.left = `${left + (offset?.dx ?? 0)}px`;
      card.style.top = `${top + (offset?.dy ?? 0)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(domNode);
    observer.observe(card);
    // Node movement and edge rerouting need not resize the pane or change its viewport transform.
    const geometry = new MutationObserver(place);
    geometry.observe(anchor.closest(".react-flow__node, .react-flow__edge") ?? anchor, {
      attributes: true,
      subtree: true,
      attributeFilter: ["style", "d", "transform"],
    });
    const stopControls = observeProtectedControls(wrap, place);
    return () => {
      observer.disconnect();
      geometry.disconnect();
      stopControls();
    };
  }, [domNode, transform, kind, id, presenting, pinned]);
  useLayoutEffect(() => {
    if (ref.current && (focusClaim ? focusClaim() : pinned))
      interaction.dispatch({ type: "node.details", target: ref.current });
  }, [pinned, focusClaim, interaction]);
  useLayoutEffect(() => {
    if (!domNode) return;
    const anchor = domNode.querySelector(`[data-testid="${kind}-${CSS.escape(id)}"]`)?.closest("[tabindex]");
    if (!anchor) return;
    const old = anchor.getAttribute("aria-describedby");
    const testId = anchor.getAttribute("data-testid");
    if (kind === "node") anchor.setAttribute("data-testid", `node-live-focus-${id}`);
    anchor.setAttribute("aria-describedby", [old, descriptionId].filter(Boolean).join(" "));
    return () => {
      if (kind === "node") {
        if (testId === null) anchor.removeAttribute("data-testid");
        else anchor.setAttribute("data-testid", testId);
      }
      if (old === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", old);
    };
  }, [domNode, kind, id, descriptionId]);
  const pin = () => interaction.readouts?.pin({ kind, id });
  const toggle = (key: string) => {
    if (!pinned) pin();
    setOpen((old) => (old === key ? null : key));
  };
  return createPortal(
    <div
      ref={ref}
      id={cardId}
      className={`lv-hover-card nowheel nopan${pinned ? " is-pinned" : ""}${problem ? (problem.severe ? " is-bad" : " is-warning") : ""}`}
      role={pinned ? "region" : "tooltip"}
      aria-label={t("hover.card", { name })}
      tabIndex={pinned ? 0 : -1}
      data-testid={`${kind}-detail-${id}`}
      data-live-readout={kind}
      data-item={id}
      data-canvas-reading-region=""
      data-pinned={pinned ? "true" : "false"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!pinned) pin();
      }}
      onFocusCapture={(e) => {
        // Reveal the focused section inside its card without scrolling the canvas.
        const target = e.target.getBoundingClientRect(),
          viewport = e.currentTarget.getBoundingClientRect();
        if (target.top < viewport.top) e.currentTarget.scrollTop -= viewport.top - target.top;
        else if (target.bottom > viewport.bottom) e.currentTarget.scrollTop += target.bottom - viewport.bottom;
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab" && e.shiftKey && e.target === e.currentTarget) {
          const anchor = domNode?.querySelector(`[data-testid="${kind}-${CSS.escape(id)}"]`)?.closest("[tabindex]");
          if (anchor) {
            e.preventDefault();
            interaction.dispatch({ type: "node.details", target: anchor });
          }
          return;
        }
        if (e.target === e.currentTarget && ["Home", "End", "PageDown", "PageUp", " "].includes(e.key)) {
          e.preventDefault();
          const el = e.currentTarget;
          const delta = el.clientHeight * 0.875;
          el.scrollTo({
            top:
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? el.scrollHeight
                  : el.scrollTop + (e.key === "PageUp" || (e.key === " " && e.shiftKey) ? -delta : delta),
            behavior: "instant",
          });
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          interaction.readouts?.close("escape");
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-hover-row]")];
          const current = rows.indexOf(document.activeElement as HTMLElement);
          const index =
            current < 0
              ? e.key === "ArrowDown"
                ? 0
                : rows.length - 1
              : (current + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
          const next = rows[index];
          if (next) {
            e.preventDefault();
            interaction.dispatch({ type: "node.details", target: next });
          }
        }
      }}
    >
      <div id={descriptionId} data-testid={`hover-description-${kind}-${id}`} className="hover-card-content">
        <header className="hover-header">
          <span className="hover-kind-icon" aria-hidden>
            {kind === "edge" ? "↔" : "▤"}
          </span>
          <span className="hover-name">
            <strong data-testid="hover-full-name">
              <bdi>{name}</bdi>
            </strong>
            <small>{type}</small>
          </span>
          <HoverStatus summary={summary} />
        </header>
        <HoverVerdict summary={summary} healthy={healthy} />
        <HoverVitals summary={summary} />
        <AttentionRows key={pinned ? "attention-pinned" : "attention-compact"} facts={summary.facts} />
        <SectionRows
          key={pinned ? "sections-pinned" : "sections-compact"}
          summary={summary}
          pinned={pinned}
          kind={kind}
          open={open}
          toggle={toggle}
          render={children}
        />
        <footer>{pinned ? t("hover.pinned") : t("hover.pin")}</footer>
      </div>
    </div>,
    document.body,
  );
}

function AttentionRows({ facts }: { facts: HoverFact[] }) {
  const [order] = useState(() => facts.slice(0, 2).map((f) => f.key));
  return (
    <div className="hover-attention">
      {order.map((key) => {
        const fact = facts.find((f) => f.key === key);
        return (
          <div key={key} className={fact?.bad ? "is-bad" : ""} data-testid={`hover-attention-${key}`}>
            <span aria-hidden>{fact?.bad ? "⊗" : "·"}</span>
            <span title={fact?.label}>{fact?.label ?? t("hover.resolved")}</span>
            <b className="mono">
              <bdi dir="ltr">{fact?.value}</bdi>
            </b>
          </div>
        );
      })}
    </div>
  );
}
