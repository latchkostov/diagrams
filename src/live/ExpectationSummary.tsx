import { memo, useEffect, useRef } from "react";
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
        <span className="mono">
          {passed}/{expectations.length}
        </span>
      </button>
      {open && (
        <div className="lv-checks-pop" role="dialog" aria-label="Expectations" data-testid="live-expectations-list">
          <ul>
            {expectations.map((e) => {
              const value = Number.isInteger(e.value) ? formatCount(e.value) : e.value.toFixed(1);
              const word = e.status === "pass" ? "holds" : e.status === "fail" ? "failed" : "pending";
              return (
                <li key={e.id} className={`is-${e.status}`} data-testid={`expectation-row-${e.id}`}>
                  <span className={`lv-exp is-${e.status}`} aria-hidden>
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
      )}
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
  return (
    <>
      <div
        className={`lv-checks${done ? (failed ? " is-fail" : " is-pass") : ""}`}
        data-testid="live-expectations"
        title={`${passed} of ${expectations.length} expectations hold`}
      >
        {expectations.map((e) => (
          <ExpectationDot key={e.id} e={e} />
        ))}
      </div>
      <ExpectationSummary expectations={expectations} passed={passed} failed={failed} done={done} />
    </>
  );
}

const ExpectationDot = memo(function ExpectationDot({ e }: { e: ExpectationState }) {
  const value = Number.isInteger(e.value) ? formatCount(e.value) : e.value.toFixed(1);
  const word = e.status === "pass" ? "holds" : e.status === "fail" ? "failed" : "pending";
  return (
    <span
      className={`lv-exp is-${e.status}`}
      data-testid={`expectation-${e.id}`}
      data-status={e.status}
      data-value={e.value}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus exposes an informational tooltip to keyboard users; it has no button action.
      tabIndex={0}
      aria-label={`${e.label}: ${word}, now ${value}`}
    >
      {e.status === "pass" ? (
        <LiveIcon name="check" size={10} />
      ) : e.status === "fail" ? (
        <LiveIcon name="x" size={10} />
      ) : null}
      <span className="lv-exp-tip" role="tooltip">
        <b>{e.label}</b>
        <span>
          {word} · now <span className="mono">{value}</span>
        </span>
      </span>
    </span>
  );
});
