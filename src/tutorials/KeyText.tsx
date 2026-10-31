import { Fragment, type ReactNode } from "react";
import { t } from "../i18n";
import { isMac } from "../editor/shortcuts";

/**
 * Instruction text: instruction words with keys drawn as key chips. Marked keys ("[Alt]+[→]") always become chips;
 * unmarked lesson text gets the common shapes ("Alt+→", "Shift+0", "press Enter", "Escape twice") so existing lessons
 * read the same way without edits. Arrows are chips with their names for screen readers, never a bare glyph in text.
 */
const NAMES: Record<string, () => string> = {
  "→": () => t("tutorials.coach.rightArrow"),
  "←": () => t("tutorials.coach.leftArrow"),
  "↑": () => t("tutorials.coach.upArrow"),
  "↓": () => t("tutorials.coach.downArrow"),
  ArrowRight: () => t("tutorials.coach.rightArrow"),
  ArrowLeft: () => t("tutorials.coach.leftArrow"),
  ArrowUp: () => t("tutorials.coach.upArrow"),
  ArrowDown: () => t("tutorials.coach.downArrow"),
};
const LABELS: Record<string, () => string> = {
  Ctrl: () => t("keys.ctrl"),
  Shift: () => t("keys.shift"),
  Alt: () => t("keys.alt"),
  Option: () => t("keys.alt"),
  Enter: () => t("keys.enter"),
  Escape: () => t("keys.escape"),
  Esc: () => t("keys.escape"),
  Tab: () => t("keys.tab"),
  Delete: () => t("keys.delete"),
  Space: () => t("keys.space"),
  Backspace: () => t("keys.backspace"),
};
const GLYPH: Record<string, string> = { ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓" };
const TURN: Record<string, number> = { "→": 0, "↓": 90, "←": 180, "↑": 270 };
const KEY = String.raw`(?:ControlOrMeta|Ctrl\/Cmd|Ctrl|Cmd|Meta|Mod|Alt|Shift|Option|Enter|Escape|Esc|Tab|Delete|Backspace|Space|Arrow(?:Right|Left|Up|Down)|F(?:1[0-2]|[1-9])|[→←↑↓]|[A-Z0-9])`;
const MOD = String.raw`(?:ControlOrMeta|Ctrl\/Cmd|Ctrl|Cmd|Meta|Mod|Alt|Shift|Option)`;
const PATTERN = new RegExp(
  String.raw`\[([^\]]+)\](?:\+\[([^\]]+)\])*|\b${MOD}(?:\+${KEY})+|\b${MOD}(?=[+-](?:drag|click))|\b(?:Enter|Escape|Esc|Tab|Delete|Backspace)\b|(?<=\b(?:press|Press)\s)[A-Z0-9]\b|[→←↑↓]`,
  "g",
);

function Key({ k, mac, literalCtrl }: { k: string; mac: boolean; literalCtrl: boolean }) {
  // The node's own "+" (the grow chip), drawn as it looks on the canvas.
  if (k === "+")
    return (
      <span className="coach-key is-plus" role="img" aria-label="+">
        +
      </span>
    );
  const name = NAMES[k]?.();
  const display =
    /^(ControlOrMeta|Ctrl\/Cmd|Mod|Meta|Cmd)$/.test(k) || (k === "Ctrl" && !literalCtrl)
      ? mac
        ? "⌘"
        : t("keys.ctrl")
      : (LABELS[k]?.() ?? k);
  const turn = TURN[GLYPH[k] ?? k];
  return (
    <kbd
      data-testid={turn === undefined ? "coach-key" : "coach-key-arrow"}
      className="coach-key"
      role={name ? "img" : undefined}
      aria-label={name}
      title={name}
    >
      {turn === undefined ? (
        display
      ) : (
        // Arrows are drawn: a font's arrow glyph at chip size reads as a dash.
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden style={{ rotate: `${turn}deg` }}>
          <path
            d="M2 6h8M6.5 2.5 10 6l-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </kbd>
  );
}

function Combo({ keys, mac }: { keys: string[]; mac: boolean }) {
  return (
    <span className="coach-combo">
      {keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="coach-plus">+</span>}
          <Key k={k} mac={mac} literalCtrl={keys.includes("Alt")} />
        </Fragment>
      ))}
    </span>
  );
}

export function KeyText({ text, mac = isMac() }: { text: string; mac?: boolean }): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    if (start > at) out.push(text.slice(at, start));
    const raw = match[0];
    const keys = raw.startsWith("[") ? [...raw.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]) : raw.split(/\+(?=.)/);
    out.push(<Combo key={start} keys={keys} mac={mac} />);
    at = start + raw.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Legacy tips often repeat the heading; keep the actionable goal prominent instead. */
export function CoachText({ title, goal, tip }: { title: string; goal: string; tip: string | null }) {
  const primary = tip && tip !== title ? tip : goal;
  return (
    <>
      <KeyText text={primary} />
      {primary !== goal && (
        <span className="coach-summary">
          <KeyText text={goal} />
        </span>
      )}
    </>
  );
}
