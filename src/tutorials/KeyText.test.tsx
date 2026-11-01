import { t } from "../i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CoachText, KeyText } from "./KeyText";
import { pseudoText } from "../i18n/pseudo";

it.each(["Drag Service 3 into the boundary.", pseudoText("Drag Service 3 into the boundary.")])(
  "keeps a bracketed instruction as wrapping prose: %s",
  (words) => {
    const text = `[${words}]`;
    expect(renderToStaticMarkup(<KeyText text={text} mac={false} />)).toBe(text);
  },
);

it.each(["[Press [Alt]+[→] to connect.]", "[[Alt]+[→] to connect.]"])(
  "recognises marked keys inside a bracketed sentence without consuming its wrapper: %s",
  (text) => {
    const html = renderToStaticMarkup(<KeyText text={text} mac={false} />);
    expect(html.match(/<kbd/g)).toHaveLength(2);
    expect(html).toMatch(/^\[(?:Press )?</);
    expect(html).toMatch(/ to connect\.\]$/);
    expect(html).toContain('aria-label="Right arrow"');
  },
);

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
  expect(renderToStaticMarkup(<KeyText text="[[]" />)).toContain("[</kbd>");
});
it.each([false, true])("uses the product's platform modifiers, retaining literal Ctrl+Alt navigation (%s)", (mac) => {
  const html = renderToStaticMarkup(<KeyText text="Ctrl+K; Ctrl+drag; ControlOrMeta+Z; Ctrl+Alt+→" mac={mac} />);
  expect(html.match(mac ? /⌘/g : /Ctrl<\/kbd>/g)).toHaveLength(mac ? 3 : 4);
  expect(html).toContain("Ctrl</kbd>");
  expect(html).toContain("Alt</kbd>");
});

it.each([false, true])("recognises the whole Ctrl/Cmd modifier without leaving prose behind (%s)", (mac) => {
  const html = renderToStaticMarkup(<KeyText text="Finish with Ctrl/Cmd+Enter." mac={mac} />);
  expect(html.replace(/<[^>]*>/g, "")).toBe(`Finish with ${mac ? "⌘" : "Ctrl"}+Enter.`);
  expect(html.match(/<kbd/g)).toHaveLength(2);
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
  expect(plain).toBe(`<span data-testid="coach-objective">${words.goal}</span>`);
  const precise = renderToStaticMarkup(<CoachText {...words} tip="Click this dot." />);
  expect(precise).toContain("Click this dot.");
  expect(precise).toContain(words.goal);
});

it("keeps a complete instruction and its shortcut chips in one inline block", () => {
  const goal = "Name it Web API, then press Enter.";
  expect(renderToStaticMarkup(<CoachText title={t("tutorials.quickAdd.nameApiTitle")} goal={goal} tip={goal} />)).toBe(
    `<span data-testid="coach-objective">${renderToStaticMarkup(<KeyText text={goal} />)}</span>`,
  );
});

it("shows distinct mechanics alongside the goal and deduplicates a route summary that repeats it", () => {
  const title = t("tutorials.dotsAndSides.connectTitle");
  const html = renderToStaticMarkup(<CoachText title={title} goal="Connect Service A." tip="Choose Service A." />);
  expect(html.match(/Connect Service A\./g)).toHaveLength(1);
  expect(html.match(/Choose Service A\./g)).toHaveLength(1);
  expect(renderToStaticMarkup(<CoachText title={title} goal="Connect Service A." tip="Connect Service A." />)).toBe(
    '<span data-testid="coach-objective">Connect Service A.</span>',
  );
  expect(
    renderToStaticMarkup(
      <CoachText title={title} goal="Connect Service A." tip="Connect Service A. Choose Service A." />,
    ),
  ).toBe(html);
});
