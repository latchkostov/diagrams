import { t } from "../i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CoachText, KeyText } from "./KeyText";

it("chips existing combinations and Enter, drawing arrows instead of raw glyphs", () => {
  const html = renderToStaticMarkup(<KeyText text="Press Alt+→, Shift+0, then press Enter." mac={false} />);
  expect(html.match(/<kbd/g)).toHaveLength(5);
  expect(html).toContain('aria-label="Right arrow"');
  expect(html).toContain('role="img"');
  expect(html).toContain("<svg");
  expect(html).not.toContain("→");
  expect(html).toContain("Enter</kbd>");
});
it("keeps ordinary prose and draws explicit translated key marks and the grow control", () => {
  const html = renderToStaticMarkup(<KeyText text="[Alt]+[ArrowDown] [+] PostgreSQL" mac={false} />);
  expect(html).toContain('aria-label="Down arrow"');
  expect(html).toContain('aria-label="+"');
  expect(html).toContain("PostgreSQL");
  expect(renderToStaticMarkup(<KeyText text="Read the diagram." />)).toBe("Read the diagram.");
});
it.each([false, true])("uses the product's platform modifiers, retaining literal Ctrl+Alt navigation (%s)", (mac) => {
  const html = renderToStaticMarkup(<KeyText text="Ctrl+K; Ctrl+drag; ControlOrMeta+Z; Ctrl+Alt+→" mac={mac} />);
  expect(html.match(mac ? /⌘/g : /Ctrl<\/kbd>/g)).toHaveLength(mac ? 3 : 4);
  expect(html).toContain("Ctrl</kbd>");
  expect(html).toContain("Alt</kbd>");
});

it("draws named arrows in existing unmarked combinations", () => {
  const html = renderToStaticMarkup(<KeyText text="Alt+ArrowRight, Shift+F10" mac={false} />);
  expect(html).toContain('aria-label="Right arrow"');
  expect(html).not.toContain("rrowRight</");
  expect(html).toContain("F10</kbd>");
});

it("shows the instruction once when a legacy tip repeats the heading, while retaining precise control tips", () => {
  const words = {
    title: t("tutorials.workbenchTour.propertiesTitle"),
    goal: t("tutorials.workbenchTour.propertiesGoal"),
  };
  const plain = renderToStaticMarkup(<CoachText {...words} tip={words.title} />);
  expect(plain).toBe(words.goal);
  const precise = renderToStaticMarkup(<CoachText {...words} tip="Click this dot." />);
  expect(precise).toContain("Click this dot.");
  expect(precise).toContain(words.goal);
});
