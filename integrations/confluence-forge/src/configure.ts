import { requestConfluence, view } from "@forge/bridge";
import { t } from "../../../src/i18n/core";
import type { DiagramFile } from "../../../src/model/types";
import { configForStorage, contentId, DEFAULT_CONFIG } from "./config";
import { DIAGRAM_FILE_ACCEPT, downloadDiagram, listAttachments, stageDiagram, uploadDiagram } from "./attachments";
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
  let fitPreview = () => {};
  new ResizeObserver(() => fitPreview()).observe(content);
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
  form.addEventListener("submit", (event) => event.preventDefault());
  document.body.append(form);
  let closed = false;
  let phase: "initialising" | "ready" | "submitting" = "initialising";
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
    if (phase === "submitting" || closed) return;
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
  const acceptsFile = () => {
    if (closed) return false;
    if (phase === "ready") return true;
    showError(new Error(t("viewerForge.waitForFile")));
    return false;
  };
  let chooseFile = (_chosen?: File) => {};
  file.addEventListener("change", () => {
    if (acceptsFile()) chooseFile(file.files?.[0]);
    else file.value = "";
  });
  content.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = phase === "ready" && !closed ? "copy" : "none";
    if (phase === "ready" && !closed) content.classList.add("dragging");
  });
  content.addEventListener("dragleave", () => content.classList.remove("dragging"));
  content.addEventListener("drop", (event) => {
    event.preventDefault();
    content.classList.remove("dragging");
    if (acceptsFile()) chooseFile(event.dataTransfer?.files[0]);
  });
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
    let selection: { file: File; generation: number } | undefined;
    let uploaded: { generation: number; attachmentId: string } | undefined;
    let diagram: DiagramFile | undefined;
    let fileLoading = false;
    let optionsOpen = false;
    let height = config.height;
    let theme = config.theme;
    let simulation = config.simulation;
    const canSubmit = () =>
      !closed &&
      phase === "ready" &&
      !fileLoading &&
      !!diagram &&
      (!simulation || !!diagram.simulations?.some((sim) => sim.id === simulation));
    const refresh = () => {
      save.disabled = !canSubmit();
      reason.textContent = canSubmit() ? "" : t("viewerForge.chooseToContinue");
    };
    const button = (testid: string, text: string, action: () => void) => {
      const control = element("button", testid, text);
      control.type = "button";
      control.addEventListener("click", action);
      return control;
    };
    const pickFile = () => {
      if (acceptsFile()) file.click();
    };
    const render = () => {
      fitPreview = () => {};
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
          t("viewerForge.selectedFile", { filename: selection?.file.name ?? editTarget?.title ?? "" }),
        );
        const details = element("div", "forge-card-details");
        details.append(
          element("span", "forge-filename", selection?.file.name ?? editTarget?.title),
          button("forge-change", editing ? t("viewerForge.replaceFile") : t("viewerForge.change"), pickFile),
        );
        const preview = diagramPreview(diagram);
        card.append(preview.svg, details);
        fitPreview = preview.fit;
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
          if (saved.some((sim) => sim.id === simulation)) clearError();
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
        fitPreview();
      }
      refresh();
    };
    const choose = async (chosen?: File) => {
      if (!chosen || !acceptsFile()) return;
      const chosenGeneration = ++generation;
      uploaded = undefined;
      fileLoading = true;
      refresh();
      clearError();
      try {
        const next = await stageDiagram(chosen);
        if (closed || chosenGeneration !== generation) return;
        diagram = next;
        selection = { file: chosen, generation: chosenGeneration };
        fileLoading = false;
        if (!next.simulations?.some((sim) => sim.id === simulation)) simulation = "";
        render();
        content.querySelector<HTMLElement>('[data-testid="forge-card"]')?.focus();
      } catch (error) {
        if (!closed && chosenGeneration === generation) {
          fileLoading = false;
          refresh();
          showError(error);
        }
      } finally {
        if (chosenGeneration === generation) file.value = "";
      }
    };
    chooseFile = (chosen) => void choose(chosen);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!canSubmit()) return;
      const committedSelection = selection;
      const committedConfig = { simulation, height, theme };
      phase = "submitting";
      fields.disabled = cancel.disabled = true;
      save.textContent = editing ? t("viewerForge.updating") : t("viewerForge.inserting");
      clearError();
      refresh();
      void (async () => {
        try {
          let attachmentId = editTarget?.id;
          if (committedSelection) {
            if (uploaded?.generation !== committedSelection.generation) {
              // An unresolved edit target must be looked up by ID, never by the replacement's name.
              const replace = editTarget?.title
                ? { id: editTarget.id, title: editTarget.title }
                : editTarget
                  ? (await listAttachments(requestConfluence, page)).find((item) => item.id === editTarget.id)
                  : undefined;
              if (editTarget && !replace) throw new Error(t("viewerForge.attachmentMissing"));
              const attachment = await uploadDiagram(requestConfluence, page, committedSelection.file, replace);
              uploaded = { generation: committedSelection.generation, attachmentId: attachment.id };
            }
            attachmentId = uploaded.attachmentId;
          }
          try {
            await view.submit({
              config: configForStorage({ attachmentId, ...committedConfig }),
            });
          } catch {
            throw new Error(t("viewerForge.saveError"));
          }
          closed = true; // Forge submit closes the configuration surface.
        } catch (error) {
          showError(error);
        } finally {
          phase = "ready";
          fields.disabled = cancel.disabled = false;
          save.textContent = editing ? t("viewerForge.update") : t("viewerForge.insert");
          refresh();
        }
      })();
    });
    render();
    const initialGeneration = generation;
    let loadError: unknown;
    // Resolve once from the saved config. Upload checkpoints never change the edit target.
    const editTarget: Readonly<{ id: string; title?: string }> | undefined = editing
      ? await listAttachments(requestConfluence, page)
          .then((attachments) => {
            const target = attachments.find((item) => item.id === config.attachmentId);
            if (!target) throw new Error(t("viewerForge.attachmentMissing"));
            return target;
          })
          .catch((error: unknown) => {
            loadError = error;
            return { id: config.attachmentId };
          })
      : undefined;
    if (closed) return;
    try {
      if (editTarget && !loadError) {
        const initialDiagram = await downloadDiagram(requestConfluence, page, editTarget.id);
        if (closed || generation !== initialGeneration) return;
        diagram = initialDiagram;
        optionsOpen = !!simulation && !diagram.simulations?.some((sim) => sim.id === simulation);
      }
    } catch (error) {
      loadError = error;
    }
    if (closed || generation !== initialGeneration) return;
    phase = "ready";
    fields.disabled = false;
    render();
    clearError();
    if (loadError) showError(loadError);
    else if (diagram && !canSubmit()) showError(new Error(t("viewerForge.missingSimulation")));
  } catch (error) {
    if (!closed) showError(error);
  }
}

void main();
