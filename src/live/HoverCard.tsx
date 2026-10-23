import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";
import { hoverTop, hoverRoom } from "./hoverPlacement";
import type { HoverFact, HoverSummary } from "./hoverSummary";

export interface HoverCardProps {
  kind: "node" | "edge";
  id: string;
  name: string;
  type: string;
  pinned: boolean;
  presenting: boolean;
  summary: HoverSummary;
  healthy: string;
  children(section: string): ReactNode;
}

/** Screen-space frame and recovery UI stay outside deferred detail chunks. */
export function HoverCard({ kind, id, name, type, pinned, presenting, summary, healthy, children }: HoverCardProps) {
  const interaction = useInteraction()!;
  const ref = useRef<HTMLDivElement>(null);
  const domNode = useStore((s) => s.domNode);
  const transform = useStore((s) => s.transform);
  const [open, setOpen] = useState<string | null>(null);
  const problem = summary.problems[0];
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !domNode) return;
    const anchor = domNode.querySelector<HTMLElement>(`[data-testid="${kind}-${CSS.escape(id)}"]`);
    if (!anchor) return;
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
      card.style.left = `${Math.max(bounds.left + 12, Math.min(left, bounds.right - size.width - 12))}px`;
      card.style.top = `${hoverTop({ top: bounds.top, bottom }, rect, size.height)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(domNode);
    observer.observe(card);
    return () => observer.disconnect();
  }, [domNode, transform, kind, id, presenting]);
  useLayoutEffect(() => {
    if (pinned && ref.current) interaction.dispatch({ type: "node.details", target: ref.current });
  }, [pinned, interaction]);
  useLayoutEffect(() => {
    if (!domNode) return;
    const anchor = domNode.querySelector(`[data-testid="${kind}-${CSS.escape(id)}"]`)?.closest("[tabindex]");
    if (!anchor) return;
    const old = anchor.getAttribute("aria-describedby");
    const testId = anchor.getAttribute("data-testid");
    if (kind === "node") anchor.setAttribute("data-testid", `node-live-focus-${id}`);
    anchor.setAttribute(
      "aria-describedby",
      [old, `live-${kind}-description-${encodeURIComponent(id)}`].filter(Boolean).join(" "),
    );
    return () => {
      if (kind === "node") {
        if (testId === null) anchor.removeAttribute("data-testid");
        else anchor.setAttribute("data-testid", testId);
      }
      if (old === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", old);
    };
  }, [domNode, kind, id]);
  const pin = () => interaction.pinReadout({ kind, id });
  const toggle = (key: string) => {
    if (!pinned) pin();
    setOpen((old) => (old === key ? null : key));
  };
  return createPortal(
    <div
      ref={ref}
      id={`live-${kind}-detail-${encodeURIComponent(id)}`}
      className={`lv-hover-card nowheel nopan${pinned ? " is-pinned" : ""}${problem ? (problem.severe ? " is-bad" : " is-warning") : ""}`}
      role={pinned ? "region" : "tooltip"}
      aria-label={t("hover.card", { name })}
      tabIndex={pinned ? 0 : -1}
      data-testid={`${kind}-detail-${id}`}
      data-live-readout={kind}
      data-item={id}
      data-live-node-detail={kind === "node" ? id : undefined}
      data-canvas-reading-region=""
      data-pinned={pinned ? "true" : "false"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!pinned) pin();
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
          interaction.closeReadout("escape");
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
      <div
        id={`live-${kind}-description-${encodeURIComponent(id)}`}
        data-testid={`hover-description-${kind}-${id}`}
        className="hover-card-content"
      >
        <header className="hover-header">
          <span className="hover-kind-icon" aria-hidden>
            {kind === "edge" ? "↔" : "▤"}
          </span>
          <span className="hover-name">
            <strong title={name}>{name}</strong>
            <small>{type}</small>
          </span>
          <span className="hover-status">
            <span aria-hidden>{problem ? (problem.severe ? "⊗" : "△") : "✓"}</span>{" "}
            {problem ? t("hover.attention") : t("hover.healthy")}
          </span>
        </header>
        <p className="hover-verdict" data-testid="hover-verdict">
          <span aria-hidden>{problem ? (problem.severe ? "⊗" : "△") : "✓"}</span>
          <span>{problem?.text ?? healthy}</span>
        </p>
        <div className="hover-vitals" data-testid="hover-vitals">
          {summary.vitals.map((v) => (
            <div key={v.key} className={v.bad ? "is-bad" : ""}>
              <b className="mono" title={v.value}>
                {v.value}
              </b>
              <small>{v.label}</small>
              {v.ratio !== undefined && Number.isFinite(v.ratio) ? (
                <meter min={0} max={1} value={Math.min(1, Math.max(0, v.ratio))} aria-label={v.label} />
              ) : (
                <span className="hover-meter-space" aria-hidden />
              )}
            </div>
          ))}
        </div>
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
            <b className="mono">{fact?.value}</b>
          </div>
        );
      })}
    </div>
  );
}

function SectionRows({
  summary,
  pinned,
  kind,
  open,
  toggle,
  render,
}: Pick<HoverCardProps, "summary" | "pinned" | "kind"> & {
  open: string | null;
  toggle(key: string): void;
  render(section: string): ReactNode;
}) {
  const sectionFor = (key: string): string =>
    kind === "edge"
      ? key === "retry"
        ? "retries"
        : "timeouts"
      : key === "timeout"
        ? "latency"
        : key === "memory"
          ? "resources"
          : key === "threads" || key === "retry"
            ? "threads"
            : "outcomes";
  const badSections = summary.problems.filter((p) => p.severe).map((p) => sectionFor(p.key));
  const [order] = useState(() => {
    const priority = summary.problems.map((p) => sectionFor(p.key));
    const rank = (key: string) => (priority.includes(key) ? priority.indexOf(key) : priority.length);
    return summary.sections.map((s) => s.key).sort((a, b) => rank(a) - rank(b));
  });
  let sections = [...summary.sections].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (pinned && kind === "node")
    sections = [
      ...sections,
      { key: "outcomes", label: t("hover.outcomes"), summary: "" },
      { key: "planning", label: t("hover.planning"), summary: "" },
    ]
      .filter((s, i, all) => all.findIndex((a) => a.key === s.key) === i)
      .map((s) => (s.key === "planning" ? { ...s, label: t("hover.planning") } : s));
  return (
    <div className="hover-sections">
      {sections.map((s) => (
        <section key={s.key} className={`hover-rail is-${s.key}${badSections.includes(s.key) ? " is-bad" : ""}`}>
          <button
            data-testid={`hover-section-${s.key}`}
            data-hover-row=""
            tabIndex={pinned ? 0 : -1}
            aria-expanded={pinned && open === s.key}
            onClick={(e) => {
              e.stopPropagation();
              toggle(s.key);
            }}
          >
            <span aria-hidden>
              {s.key === "threads" ? "☷" : s.key === "latency" ? "◷" : s.key === "resources" ? "▦" : "≡"}
            </span>
            <strong>{s.label}</strong>
            <small>{s.summary}</small>
            <span aria-hidden>{pinned && open === s.key ? "⌄" : "›"}</span>
          </button>
          {pinned && open === s.key && render(s.key)}
        </section>
      ))}
    </div>
  );
}
