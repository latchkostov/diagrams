import { requestConfluence, view } from "@forge/bridge";
import { t } from "../../../src/i18n/core";
import type { DiagramFile } from "../../../src/model/types";
import { configForStorage, contentId, DEFAULT_CONFIG } from "./config";
import {
  DIAGRAM_FILE_ACCEPT,
  downloadDiagram,
  listAttachments,
  stageDiagram,
  uploadDiagram,
  type Attachment,
} from "./attachments";
import { element, errorMessage, followTheme } from "./dom";
import { HEIGHT_PRESETS } from "./height";
import { diagramPreview } from "./preview";
import "./configure.css";

async function main() {
  const form = element("form", "forge-config");
  const heading = element("h1", "forge-title", t("viewerForge.title"));
  const fields = element("fieldset", "forge-fields");
  fields.disabled = true;
  const content = element("div", "forge-content");
  const status = element("p", "forge-config-status", t("viewerForge.loading"));
  status.id = "forge-config-status";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const footer = element("footer", "forge-footer");
  const reason = element("span", "forge-reason", t("viewerForge.chooseToContinue"));
  reason.id = "forge-reason";
  const cancel = element("button", "forge-cancel", t("viewerForge.cancel"));
  cancel.type = "button";
  const save = element("button", "forge-save", t("viewerForge.insert"));
  save.type = "submit";
  save.disabled = true;
  save.className = "primary";
  save.setAttribute("aria-describedby", reason.id);
  const file = element("input", "forge-file");
  file.type = "file";
  file.accept = DIAGRAM_FILE_ACCEPT;
  file.hidden = true;
  file.setAttribute("aria-label", t("viewerForge.file"));
  fields.append(file, content);
  footer.append(reason, cancel, save);
  form.append(heading, fields, status, footer);
  document.body.append(form);
  let closed = false;
  let saving = false;
  let generation = 0;
  const clearError = () => {
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "";
  };
  const showError = (error: unknown) => {
    status.setAttribute("role", "alert");
    status.setAttribute("aria-live", "assertive");
    status.textContent = errorMessage(error);
    status.focus();
  };
  const close = async () => {
    if (saving || closed) return;
    closed = true;
    generation++;
    try {
      await view.close();
    } catch {
      closed = false;
      showError(new Error(t("viewerForge.bridgeError")));
    }
  };
  cancel.addEventListener("click", () => void close());
  let popupOpen = false;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (popupOpen) {
      popupOpen = false;
      return;
    }
    event.preventDefault();
    void close();
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") popupOpen = false;
  });
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  // The settings surface always follows Confluence, independently of the diagram's saved theme.
  followTheme(DEFAULT_CONFIG, () => view.theme.enable());
  try {
    const context = await view.getContext();
    if (closed) return;
    const config = configForStorage(context.extension.config);
    const editing = !!config.attachmentId;
    save.textContent = editing ? t("viewerForge.update") : t("viewerForge.insert");
    let page: string;
    try {
      page = contentId(context.extension.content?.id);
    } catch {
      throw new Error(t("viewerForge.pageRequired"));
    }
    let attachment: Attachment | undefined;
    let staged: File | undefined;
    let diagram: DiagramFile | undefined;
    let valid = false;
    let optionsOpen = false;
    let height = config.height;
    let theme = config.theme;
    let simulation = config.simulation;
    const refresh = () => {
      save.disabled = saving || !valid;
      reason.textContent = valid ? "" : t("viewerForge.chooseToContinue");
    };
    const button = (testid: string, text: string, action: () => void) => {
      const control = element("button", testid, text);
      control.type = "button";
      control.addEventListener("click", action);
      return control;
    };
    const pickFile = () => file.click();
    const render = () => {
      content.replaceChildren();
      if (!diagram) {
        const drop = element("div", "forge-drop");
        const choose = button("forge-choose", t("viewerForge.chooseFile"), pickFile);
        choose.className = "primary";
        drop.append(
          choose,
          element("p", "forge-drop-text", t("viewerForge.dropHere")),
          element("p", "forge-file-hint", t("viewerForge.fileHint")),
        );
        content.append(drop);
      } else {
        const card = element("section", "forge-card");
        card.tabIndex = -1;
        card.setAttribute(
          "aria-label",
          t("viewerForge.selectedFile", { filename: staged?.name ?? attachment?.title ?? "" }),
        );
        const details = element("div", "forge-card-details");
        details.append(
          element("span", "forge-filename", staged?.name ?? attachment?.title),
          button("forge-change", editing ? t("viewerForge.replaceFile") : t("viewerForge.change"), pickFile),
        );
        card.append(diagramPreview(diagram), details);
        const summaryRow = element("div", "forge-summary-row");
        const summary = element("span", "forge-summary");
        const options = button("forge-options", t("viewerForge.options"), () => {
          optionsOpen = !optionsOpen;
          options.setAttribute("aria-expanded", String(optionsOpen));
          optionsPanel.hidden = !optionsOpen;
        });
        options.setAttribute("aria-expanded", String(optionsOpen));
        options.setAttribute("aria-controls", "forge-options-panel");
        summaryRow.append(summary, options);
        const optionsPanel = element("div", "forge-options-panel");
        optionsPanel.id = "forge-options-panel";
        optionsPanel.hidden = !optionsOpen;
        const sizes = [
          [HEIGHT_PRESETS.auto, t("viewerForge.autoSize")],
          [HEIGHT_PRESETS.small, t("viewerForge.small")],
          [HEIGHT_PRESETS.medium, t("viewerForge.medium")],
          [HEIGHT_PRESETS.large, t("viewerForge.large")],
        ] as const;
        const updateSummary = () => {
          const size =
            height === 0
              ? t("viewerForge.autoSizeSummary")
              : (sizes.find(([value]) => value === height)?.[1] ?? t("viewerForge.customHeight", { height }));
          const play = simulation
            ? (diagram?.simulations?.find((sim) => sim.id === simulation)?.title ??
              t("viewerForge.missingSimulationLabel"))
            : t("viewerForge.freePlay");
          summary.textContent = t("viewerForge.summary", { play, size });
        };
        const segment = <T extends string | number>(
          id: string,
          title: string,
          choices: readonly (readonly [T, string])[],
          value: T,
          change: (value: T) => void,
        ) => {
          const group = element("fieldset", id);
          group.className = "option-group";
          group.append(element("legend", `${id}-label`, title));
          const row = element("div", `${id}-segments`);
          row.className = "segments";
          const controls = choices.map(([key, text]) => {
            const control = button(`${id}-${key}`, text, () => {
              for (const other of controls) other.setAttribute("aria-pressed", String(other === control));
              change(key);
              updateSummary();
            });
            control.setAttribute("aria-pressed", String(key === value));
            row.append(control);
            return control;
          });
          group.append(row);
          optionsPanel.append(group);
          return { group, controls };
        };
        const simulations = element("select", "forge-simulation");
        simulations.id = "forge-simulation";
        const saved = diagram.simulations ?? [];
        for (const sim of saved) simulations.add(new Option(sim.title, sim.id));
        if (simulation && !saved.some((sim) => sim.id === simulation))
          simulations.add(new Option(t("viewerForge.missingSimulationLabel"), simulation));
        simulations.value = simulation || saved[0]?.id || "";
        const selectLabel = element("label", "forge-simulation-label", t("viewerForge.simulation"));
        selectLabel.htmlFor = simulations.id;
        const play = segment(
          "forge-play-mode",
          t("viewerForge.whenPlay"),
          [
            ["free", t("viewerForge.freePlay")],
            ["saved", t("viewerForge.savedSimulation")],
          ],
          simulation ? "saved" : "free",
          (mode) => {
            simulation = mode === "free" ? "" : simulations.value;
            simulations.disabled = mode === "free";
            selectLabel.hidden = mode === "free";
            valid = !simulation || saved.some((sim) => sim.id === simulation);
            clearError();
            refresh();
          },
        );
        play.controls[1].disabled = saved.length === 0;
        const noSimulations = element("p", "forge-no-simulations", t("viewerForge.noSimulations"));
        noSimulations.id = "forge-no-simulations";
        if (!saved.length) {
          play.controls[1].setAttribute("aria-describedby", noSimulations.id);
          play.group.append(noSimulations);
        }
        selectLabel.append(simulations);
        play.group.append(selectLabel);
        simulations.disabled = !simulation;
        selectLabel.hidden = !simulation;
        simulations.addEventListener("change", () => {
          popupOpen = false;
          simulation = simulations.value;
          valid = saved.some((sim) => sim.id === simulation);
          if (valid) clearError();
          refresh();
          updateSummary();
        });
        // Native selects own the first Escape while their popup is open.
        simulations.addEventListener("pointerdown", () => {
          popupOpen = true;
        });
        simulations.addEventListener("keydown", (event) => {
          if (["ArrowDown", "ArrowUp", " ", "Enter"].includes(event.key)) popupOpen = true;
        });
        simulations.addEventListener("blur", () => {
          popupOpen = false;
        });
        const sizeChoices: (readonly [number, string])[] = [...sizes];
        if (!sizes.some(([value]) => value === height))
          sizeChoices.push([height, t("viewerForge.customHeight", { height })]);
        const size = segment("forge-height", t("viewerForge.size"), sizeChoices, height, (value) => {
          height = value;
        });
        size.group.append(element("p", "forge-height-help", t("viewerForge.autoHint")));
        segment(
          "forge-theme",
          t("viewerForge.theme"),
          [
            ["auto", t("viewerForge.autoTheme")],
            ["light", t("viewerForge.light")],
            ["dark", t("viewerForge.dark")],
          ],
          theme,
          (value) => {
            theme = value;
          },
        );
        updateSummary();
        content.append(card, summaryRow, optionsPanel);
      }
      refresh();
    };
    const choose = async (chosen?: File) => {
      if (!chosen || saving || closed) return;
      const selection = ++generation;
      valid = false;
      refresh();
      clearError();
      try {
        const next = await stageDiagram(chosen);
        if (closed || selection !== generation) return;
        diagram = next;
        staged = chosen;
        if (!next.simulations?.some((sim) => sim.id === simulation)) simulation = "";
        valid = true;
        render();
        content.querySelector<HTMLElement>('[data-testid="forge-card"]')?.focus();
      } catch (error) {
        if (!closed && selection === generation) showError(error);
      } finally {
        file.value = "";
      }
    };
    file.addEventListener("change", () => void choose(file.files?.[0]));
    content.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = saving ? "none" : "copy";
      content.classList.add("dragging");
    });
    content.addEventListener("dragleave", () => content.classList.remove("dragging"));
    content.addEventListener("drop", (event) => {
      event.preventDefault();
      content.classList.remove("dragging");
      void choose(event.dataTransfer?.files[0]);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!valid || saving || closed) return;
      saving = true;
      fields.disabled = cancel.disabled = true;
      save.textContent = editing ? t("viewerForge.updating") : t("viewerForge.inserting");
      clearError();
      refresh();
      void (async () => {
        try {
          if (staged) {
            attachment = await uploadDiagram(requestConfluence, page, staged, attachment);
            staged = undefined; // A failed config save can be retried without uploading another version.
          }
          try {
            await view.submit({
              config: configForStorage({ attachmentId: attachment?.id, simulation, height, theme }),
            });
          } catch {
            throw new Error(t("viewerForge.saveError"));
          }
          closed = true; // Forge submit closes the configuration surface.
        } catch (error) {
          showError(error);
        } finally {
          saving = false;
          fields.disabled = cancel.disabled = false;
          save.textContent = editing ? t("viewerForge.update") : t("viewerForge.insert");
          refresh();
        }
      })();
    });
    render();
    if (editing) {
      const attachments = await listAttachments(requestConfluence, page);
      if (closed) return;
      attachment = attachments.find((item) => item.id === config.attachmentId);
      if (!attachment) throw new Error(t("viewerForge.attachmentMissing"));
      diagram = await downloadDiagram(requestConfluence, page, attachment.id);
      if (closed) return;
      valid = !simulation || !!diagram.simulations?.some((sim) => sim.id === simulation);
      optionsOpen = !valid;
      render();
    }
    fields.disabled = false;
    clearError();
    if (!valid && simulation) showError(new Error(t("viewerForge.missingSimulation")));
  } catch (error) {
    if (!closed) showError(error);
  }
}

void main();
