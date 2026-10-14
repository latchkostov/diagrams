import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../interop/ui/Dialog";
import { Glyph } from "../interop/ui/glyphs";
import { t, useLocale } from "../i18n";
import { tRich } from "../i18n/rich";
import {
  available,
  browserLocale,
  chooseLocale,
  chosenLocale,
  isReviewed,
  languageName,
  suggestUrl,
} from "../i18n/load";
import "./languageDialog.css";

// View ▸ Language… and Ctrl+K's Language…: every language this copy offers, by its own name, with "Browser default"
// first. A pick applies at once (the dialog itself switches) and is remembered in this browser; Clear everything
// forgets it. Machine-translated languages say so, with a link to suggest a better translation.

interface Option {
  /** A language, or null for "Browser default". */
  code: string | null;
  /** The language's name in itself ("Deutsch"). */
  own: string;
  /** Its name in the language in use, when that differs ("German"). */
  here?: string;
  /** Words the search matches. */
  search: string;
}

function options(lang: string): Option[] {
  const collator = new Intl.Collator("en");
  const languages = available
    .map((code): Option => {
      const own = languageName(code);
      const here = languageName(code, lang);
      const english = languageName(code, "en");
      return { code, own, here: here !== own ? here : undefined, search: `${own} ${here} ${english} ${code}` };
    })
    .sort((a, b) => collator.compare(a.own, b.own));
  const browser = languageName(browserLocale());
  return [
    {
      code: null,
      own: t("language.browser"),
      here: t("language.browserDesc", { language: browser }),
      search: `${t("language.browser")} browser`,
    },
    ...languages,
  ];
}

export function LanguageDialog({ onClose }: { onClose: () => void }) {
  const lang = useLocale();
  const [chosen, setChosen] = useState(chosenLocale);
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(() => options(lang), [lang]);
  const words = query.trim().toLocaleLowerCase();
  const shown = words ? all.filter((o) => o.search.toLocaleLowerCase().includes(words)) : all;

  const pick = (code: string | null) => {
    setChosen(code);
    void chooseLocale(code);
  };

  // Arrow keys move between the rows (a native listener: the dialog keeps keys from bubbling past its panel).
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const rows = [...el.querySelectorAll<HTMLElement>("[role=radio]")];
      if (!rows.length) return;
      e.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? rows.length - 1
            : e.key === "ArrowDown"
              ? Math.min(rows.length - 1, at + 1)
              : Math.max(0, at - 1);
      rows[next].focus();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog
      title={t("language.title")}
      subtitle={t("language.subtitle")}
      icon={<GlobeGlyph />}
      onClose={onClose}
      testId="language-dialog"
      width={480}
      footer={
        <>
          {!isReviewed(lang) && (
            <p className="lang-machine" data-testid="language-machine">
              {tRich("language.machine", {
                link: (chunks) => (
                  <a href={suggestUrl(lang)} target="_blank" rel="noopener" data-testid="language-suggest">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          )}
          <span className="ix-grow" />
          <button className="btn btn-primary" onClick={onClose} data-testid="language-done">
            {t("common.done")}
          </button>
        </>
      }
    >
      {available.length > 8 && (
        <input
          className="ix-input lang-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("language.search")}
          aria-label={t("language.search")}
          data-autofocus
          data-testid="language-search"
        />
      )}
      <div ref={list} className="lang-list" role="radiogroup" aria-label={t("language.title")}>
        {shown.map((o) => {
          const on = o.code === chosen;
          return (
            <button
              key={o.code ?? ""}
              type="button"
              role="radio"
              aria-checked={on}
              className={`lang-option${on ? " is-on" : ""}`}
              onClick={() => pick(o.code)}
              data-testid={`language-option-${o.code ?? "browser"}`}
            >
              <span className="lang-text">
                <span className="lang-own" lang={o.code ?? undefined}>
                  {o.own}
                </span>
                {o.here && <span className="lang-here">{o.here}</span>}
              </span>
              {on && <Glyph name="check" size={14} />}
            </button>
          );
        })}
        {!shown.length && (
          <p className="ix-muted" data-testid="language-none">
            {t("language.none", { query: query.trim() })}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function GlobeGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14M8 2C6.3 3.8 5.5 5.8 5.5 8s.8 4.2 2.5 6" />
    </svg>
  );
}
