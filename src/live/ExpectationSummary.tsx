import { t, useLocale } from "../i18n";
import { useEffect, useRef } from "react";
import type { ExpectationState } from "../sim/types";
import { formatCount } from "./format";
import { LiveIcon } from "./icons";
import { useLivePopover } from "./useLivePopover";

/**
 * A narrow bar has no room for the dots: "2/3" opens the same results as a list (each with its
 * name, state and value), so nothing is lost to keyboard and screen-reader users.
 */
function ExpectationSummary({
  expectations,
  passed,
  failed,
  done,
}: {
  expectations: readonly ExpectationState[];
  passed: number;
  failed: boolean;
  done: boolean;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Esc gives focus back to the summary button (focus policy row M5).
  const { open, toggle, close } = useLivePopover(() => button.current);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && close("outside");
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close("escape");
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open, close]);
  const tone = failed ? " is-fail" : done ? " is-pass" : "";
  return (
    <div className="lv-checks-more" ref={root}>
      <button
        ref={button}
        className={`lv-checks-sum${tone}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Expectations: ${passed} of ${expectations.length} hold${failed ? ", some failed" : ""}. Show each`}
        data-testid="live-expectations-summary"
      >
        <LiveIcon name={failed ? "x" : "check"} size={11} />
        <span>{t("workbench.expectations", { passed, total: expectations.length })}</span>
      </button>
      <div
        className={open ? "lv-checks-pop" : undefined}
        role={open ? "dialog" : undefined}
        aria-label={open ? "Expectations" : undefined}
        data-testid={open ? "live-expectations-list" : undefined}
        hidden={!open}
      >
        <ul data-testid="live-expectations">
          {expectations.map((e) => {
            const value = Number.isInteger(e.value) ? formatCount(e.value) : e.value.toFixed(1);
            const word = e.status === "pass" ? "holds" : e.status === "fail" ? "failed" : "pending";
            return (
              <li key={e.id} className={`is-${e.status}`} data-testid={`expectation-row-${e.id}`}>
                <span
                  className={`lv-exp is-${e.status}`}
                  role="img"
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can focus each informational verdict and read its accessible name.
                  tabIndex={0}
                  aria-label={`${e.label}: ${word}, now ${value}`}
                  data-testid={`expectation-${e.id}`}
                  data-status={e.status}
                  data-value={e.value}
                >
                  {e.status === "pass" ? (
                    <LiveIcon name="check" size={10} />
                  ) : e.status === "fail" ? (
                    <LiveIcon name="x" size={10} />
                  ) : null}
                </span>
                <b>{e.label}</b>
                <span>
                  {word} · now <span className="mono">{value}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function SimulationExpectations({
  expectations,
  passed,
  failed,
  done,
}: {
  expectations: readonly ExpectationState[];
  passed: number;
  failed: boolean;
  done: boolean;
}) {
  return <ExpectationSummary expectations={expectations} passed={passed} failed={failed} done={done} />;
}
