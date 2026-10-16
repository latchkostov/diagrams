import { t } from "../i18n/core";
import { startStaticPage } from "./start";
import { find, text, content, slot } from "./dom";

void startStaticPage(() => {
  document.title = t("staticSkill.title");
  find('meta[name="description"]').setAttribute("content", t("staticSkill.description"));
  text("skill-title", t("staticSkill.title"));
  content("skill-intro", t("staticSkill.intro", { skill: slot("skill"), file: slot("file") }), ["skill", "file"]);
  text("skill-label-html", t("staticSkill.htmlLabel"));
  content("skill-output-html", t("staticSkill.html", { label: slot("label") }), ["label"]);
  text("skill-label-diagram", t("staticSkill.diagramLabel"));
  content("skill-output-diagram", t("staticSkill.diagram", { label: slot("label"), file: slot("file") }), [
    "label",
    "file",
  ]);
  text("skill-label-image", t("staticSkill.imageLabel"));
  content("skill-output-image", t("staticSkill.image", { label: slot("label") }), ["label"]);
  text("skill-label-link", t("staticSkill.linkLabel"));
  content("skill-output-link", t("staticSkill.link", { label: slot("label") }), ["label"]);
  text("skill-claude-commands", t("staticSkill.claudeCommands"));
  text("skill-claude-apps", t("staticSkill.claudeApps"));
  text("skill-settings", t("staticSkill.settings"));
  content("skill-upload", t("staticSkill.upload", { zip: slot("zip"), settings: slot("settings") }), [
    "zip",
    "settings",
  ]);
  // Both code paths remain LTR, including in Arabic; keep command bytes exactly as authored.
  content("skill-unzip", t("staticSkill.unzip", { personal: slot("personal"), repo: slot("repo") }), [
    "personal",
    "repo",
  ]);
  text("skill-other-agents", t("staticSkill.otherAgents"));
  content("skill-other", t("staticSkill.other", { folder: slot("folder"), skill: slot("skill") }), ["folder", "skill"]);
  text("skill-then-ask", t("staticSkill.thenAsk"));
  text("skill-request", t("staticSkill.request"));
  text("skill-browser-title", t("staticSkill.browserTitle"));
  text("skill-browser", t("staticSkill.browser"));
  text("skill-back", t("staticSkill.back"));
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
