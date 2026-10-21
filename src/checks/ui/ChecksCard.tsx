import "../../styles/checks.css";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "../../components/Icon";
import { RULES, summarize } from "../run";
import type { CheckResult, Finding } from "../types";
import { turnOn, unignore } from "./actions";
import { FindingRow, type RowHost, type RowState } from "./FindingRow";
import { SimulationsBar, type SimulationsHost } from "./SimulationsBar";
import { presentRule } from "../presentation";
import { useLocale } from "../../i18n";

// The Checks card (docs/research/architecture-checks.md, "Where it shows"): opened on demand, under the
// diagram card. Warnings first, then suggestions; each row selects what it involves, and its button is the
// fix. The foot brings back what was ignored or turned off. Lazy: the canvas loads it when it first opens.

export interface ChecksCardProps extends RowHost {
  /** Null while the first check is running. */
  result: CheckResult | null;
  state: RowState;
  /** Where focus goes back to when the card closes (what opened it), else the canvas. */
  returnFocus(): void;
  /** Distance from the canvas's top: just under the diagram card. */
  top: number;
  onClose(): void;
  /** The lazy card is in the DOM, ready for an overlay-aware fit. */
  onMount?(): void;
  /** Run simulations: absent where it doesn't apply. */
  simulations?: Omit<SimulationsHost, "name" | "reveal">;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ruleName = (id: string) => {
  const rule = RULES.find((r) => r.id === id);
  return rule ? presentRule(rule).name : id;
};

/**
 * Arrow keys move between rows' heads; Home and End go to the first and last. Only from a head: in the Ignore
 * reason box, Home and End move the caret, and the row's buttons keep their keys.
 */
function onListKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  if (!(e.target instanceof HTMLElement) || !e.target.hasAttribute("data-check-head")) return;
  const heads = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-check-head]")];
  if (!heads.length) return;
  const at = heads.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? heads.length - 1
        : Math.max(0, Math.min(heads.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
  e.preventDefault();
  heads[next].focus();
}

/**
 * The card's tallest: down to just above the canvas controls in the bottom-left corner (and so clear of the
 * hints and toasts along the bottom too), however tall the pane is.
 */
function useMaxHeight(card: RefObject<HTMLElement | null>, top: number): number | undefined {
  const [max, setMax] = useState<number>();
  useLayoutEffect(() => {
    const el = card.current;
    const pane = el?.parentElement;
    if (!el || !pane) return;
    const measure = () => {
      const controls = pane.querySelector<HTMLElement>(".react-flow__controls");
      const bottom = controls
        ? controls.getBoundingClientRect().top - pane.getBoundingClientRect().top
        : pane.clientHeight - 84;
      setMax(Math.max(160, Math.round(bottom - top - 12)));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [card, top]);
  return max;
}

/** Rows drawn per group before "Show more": a diagram with hundreds of findings stays light to draw. */
const PAGE = 40;

export function ChecksCard(p: ChecksCardProps) {
  useLocale();
  const onMount = useRef(p.onMount);
  useEffect(() => onMount.current?.(), []);
  const [foot, setFoot] = useState<"ignored" | "off" | "about" | null>(null);
  const [shown, setShown] = useState(PAGE);
  const self = useRef<HTMLElement>(null);
  const maxHeight = useMaxHeight(self, p.top);
  // Closing with focus inside the card (Esc, ✕, a fix that ended it) hands focus back, never to the page.
  const returnFocus = useRef(p.returnFocus);
  useEffect(() => {
    returnFocus.current = p.returnFocus;
  });
  useEffect(() => {
    const el = self.current;
    return () => {
      const at = document.activeElement;
      if (!at || at === document.body || el?.contains(at)) requestAnimationFrame(() => returnFocus.current());
    };
  }, []);
  const r = p.result;
  // The reasons for what's ignored, read once when that list is open.
  const reasons = new Map(
    foot === "ignored"
      ? (p.editor.getDiagram().checks?.ignore ?? []).map((i) => [`${i.rule}:${i.target}`, i.reason])
      : [],
  );
  const sims = p.simulations && <SimulationsBar host={{ ...p.simulations, name: p.state.name, reveal: p.reveal }} />;
  const warnings = r?.findings.filter((f) => f.severity === "warning") ?? [];
  const suggestions = r?.findings.filter((f) => f.severity === "suggestion") ?? [];
  const group = (title: string, list: Finding[], id: string) =>
    list.length > 0 && (
      <div className="checks-group" role="list" aria-label={title} data-testid={`checks-group-${id}`}>
        {list.slice(0, shown).map((f) => (
          <FindingRow key={f.id} finding={f} host={p} state={p.state} />
        ))}
        {list.length > shown && (
          <button
            type="button"
            className="link-btn checks-more"
            data-testid={`checks-more-${id}`}
            onClick={() => setShown(shown + PAGE)}
          >
            Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}
          </button>
        )}
      </div>
    );
  return (
    // Esc closes the card from anywhere inside it (one level, per the Esc rule).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className="checks-card"
      data-testid="checks-card"
      data-check-scope
      data-canvas-overlay
      aria-label="Checks"
      ref={self}
      style={{ top: p.top, ["--checks-top" as string]: `${p.top}px`, ...(maxHeight ? { maxHeight } : {}) }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.stopPropagation();
        // One level at a time: simulations playing stop first, then the card closes.
        if (!p.simulations?.stop()) p.onClose();
      }}
    >
      <header className="checks-head">
        <h2>
          <Icon name="checklist" size={14} /> Checks
        </h2>
        <button
          type="button"
          className="icon-btn icon-btn-quiet"
          aria-label="Close checks"
          title="Close (Esc)"
          data-testid="checks-close"
          data-check-fallback
          onClick={p.onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      {!r ? (
        <p className="checks-note" data-testid="checks-running">
          Checking…
        </p>
      ) : r.findings.length ? (
        <p className="checks-note" data-testid="checks-summary">
          {[
            warnings.length ? plural(warnings.length, "warning") : "",
            suggestions.length ? plural(suggestions.length, "suggestion") : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : (
        <p className="checks-note checks-empty" data-testid="checks-empty">
          <Icon name="check" size={14} />{" "}
          {r.ran.length
            ? `${summarize({ ...r, ignored: [], off: [] }).replace(/.$/, "")}.`
            : "Nothing to check yet: add a node and its checks run as you draw."}
        </p>
      )}
      {/* One place in the tree, findings or none: a run that adds the first finding keeps focus on its link. */}
      {r && sims}
      {r && r.findings.length > 0 && (
        // Arrow keys between the rows' heads (each row's head is a button).
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="checks-list" onKeyDown={onListKeys}>
          {group("Warnings", warnings, "warnings")}
          {group("Suggestions", suggestions, "suggestions")}
        </div>
      )}
      {r && (
        <footer className="checks-foot">
          {r.ignored.length > 0 && (
            <button
              type="button"
              className="link-btn"
              aria-expanded={foot === "ignored"}
              data-testid="checks-ignored-toggle"
              onClick={() => setFoot(foot === "ignored" ? null : "ignored")}
            >
              {r.ignored.length} ignored
            </button>
          )}
          {r.off.length > 0 && (
            <button
              type="button"
              className="link-btn"
              aria-expanded={foot === "off"}
              data-testid="checks-off-toggle"
              onClick={() => setFoot(foot === "off" ? null : "off")}
            >
              {plural(r.off.length, "check")} off
            </button>
          )}
          <button
            type="button"
            className="link-btn is-quiet"
            aria-expanded={foot === "about"}
            data-testid="checks-about-toggle"
            onClick={() => setFoot(foot === "about" ? null : "about")}
          >
            About checks
          </button>
        </footer>
      )}
      {r && foot === "ignored" && (
        <ul className="checks-aside" data-testid="checks-ignored">
          {r.ignored.map((f) => {
            const reason = reasons.get(`${f.rule}:${f.target}`);
            return (
              <li key={f.id}>
                <span>
                  {f.title}
                  {reason && <em> “{reason}”</em>}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  data-testid={`check-unignore-${f.id}`}
                  onClick={() => unignore(p.editor, f.rule, f.target)}
                >
                  Show again
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {r && foot === "off" && (
        <ul className="checks-aside" data-testid="checks-off">
          {r.off.map((id) => (
            <li key={id}>
              <span>{ruleName(id)}</span>
              <button
                type="button"
                className="link-btn"
                data-testid={`check-turn-on-${id}`}
                onClick={() => turnOn(p.editor, id, ruleName(id))}
              >
                Turn on
              </button>
            </li>
          ))}
        </ul>
      )}
      {foot === "about" && (
        <ul className="checks-aside is-about" data-testid="checks-about">
          {RULES.map(presentRule).map((rule) => (
            <li key={rule.id}>
              <span>
                <strong>{rule.name}.</strong> {rule.about}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The selection's findings at the top of the inspector, with their fixes. */
export function InspectorFindings({
  findings,
  host,
  state,
}: {
  findings: Finding[];
  host: RowHost & { open(): void };
  state: RowState;
}) {
  return (
    <div
      className="insp-findings"
      role="list"
      aria-label="Checks"
      data-testid="inspector-findings"
      data-stale={state.stale}
      data-check-scope
    >
      {findings.map((f) => (
        <FindingRow key={f.id} finding={f} host={host} state={state} compact testPrefix="inspector-check" />
      ))}
      <button type="button" className="link-btn" data-testid="inspector-open-checks" onClick={host.open}>
        All checks
      </button>
    </div>
  );
}
