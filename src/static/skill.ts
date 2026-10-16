import { t } from "../i18n/core";
import { startStaticPage } from "./start";
import { find, replaceContent, slot } from "./dom";

const strong = "strong";
const text = (selector: string, value: string) => (find(selector).textContent = value);
const content = (selector: string, value: string, slots: Record<string, string> = {}) => {
  const element = find(selector);
  replaceContent(
    element,
    value,
    Object.fromEntries(Object.entries(slots).map(([name, child]) => [name, element.querySelector(child)!])),
  );
};

void startStaticPage(() => {
  document.title = t("staticSkill.title");
  find('meta[name="description"]').setAttribute("content", t("staticSkill.description"));
  text('[data-testid="skill-title"]', t("staticSkill.title"));
  content("main > p:first-of-type", t("staticSkill.intro", { skill: slot("skill"), file: slot("file") }), {
    skill: "strong",
    file: "code",
  });
  text('[data-testid="skill-outputs"] > li:nth-child(1) > strong', t("staticSkill.htmlLabel"));
  content('[data-testid="skill-outputs"] > li:nth-child(1)', t("staticSkill.html", { label: slot("label") }), {
    label: strong,
  });
  text('[data-testid="skill-outputs"] > li:nth-child(2) > strong', t("staticSkill.diagramLabel"));
  content(
    '[data-testid="skill-outputs"] > li:nth-child(2)',
    t("staticSkill.diagram", { label: slot("label"), file: slot("file") }),
    { label: strong, file: "code" },
  );
  text('[data-testid="skill-outputs"] > li:nth-child(3) > strong', t("staticSkill.imageLabel"));
  content('[data-testid="skill-outputs"] > li:nth-child(3)', t("staticSkill.image", { label: slot("label") }), {
    label: strong,
  });
  text('[data-testid="skill-outputs"] > li:nth-child(4) > strong', t("staticSkill.linkLabel"));
  content('[data-testid="skill-outputs"] > li:nth-child(4)', t("staticSkill.link", { label: slot("label") }), {
    label: strong,
  });
  text("#claude-code + p", t("staticSkill.claudeCommands"));
  text("#claude-apps", t("staticSkill.claudeApps"));
  text("#claude-apps + p > strong", t("staticSkill.settings"));
  content("#claude-apps + p", t("staticSkill.upload", { zip: slot("zip"), settings: slot("settings") }), {
    zip: "a",
    settings: "strong",
  });
  // Both code paths remain LTR, including in Arabic; keep command bytes exactly as authored.
  content("#codex + p", t("staticSkill.unzip", { personal: slot("personal"), repo: slot("repo") }), {
    personal: "code:first-child",
    repo: "code:last-child",
  });
  text("#other-agents", t("staticSkill.otherAgents"));
  content("#other-agents + p", t("staticSkill.other", { folder: slot("folder"), skill: slot("skill") }), {
    folder: "code",
    skill: "a",
  });
  text("#try-it", t("staticSkill.thenAsk"));
  text("#try-it + p", t("staticSkill.request"));
  text("#in-the-browser", t("staticSkill.browserTitle"));
  text("#in-the-browser + p", t("staticSkill.browser"));
  text('[data-testid="skill-back"]', t("staticSkill.back"));
  document.querySelectorAll<HTMLElement>("code").forEach((code) => (code.dir = "ltr"));
  document.querySelectorAll<HTMLElement>(".cmd").forEach((command) => (command.dir = "ltr"));
  document
    .querySelectorAll<HTMLElement>("[data-copy]")
    .forEach((button) => (button.textContent = t("staticSkill.copy")));
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  button.addEventListener("click", async () => {
    const command = button.previousElementSibling!.textContent.replace(/\s+/g, " ").trim();
    try {
      await navigator.clipboard.writeText(command);
      button.textContent = t("staticSkill.copied");
    } catch {
      button.textContent = t("staticSkill.selectCopy");
    }
    setTimeout(() => (button.textContent = t("staticSkill.copy")), 2000);
  });
}
