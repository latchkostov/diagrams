import { requestConfluence, view } from "@forge/bridge";
import { t } from "../../../src/i18n/core";
import { configForStorage, contentId } from "./config";
import { downloadDiagram, listAttachments, uploadDiagram, type Attachment } from "./attachments";
import { element, errorMessage, followTheme } from "./dom";
import "../../../src/styles/tokens.css";
import "./configure.css";

async function main() {
  const form = element("form", "forge-config");
  const status = element("p", "forge-config-status", t("viewerForge.loading"));
  status.setAttribute("role", "status");
  document.body.append(form, status);
  const cancel = element("button", "forge-cancel", t("viewerForge.cancel"));
  cancel.type = "button";
  cancel.addEventListener(
    "click",
    () =>
      void view.close().catch(() => {
        status.setAttribute("role", "alert");
        status.textContent = t("viewerForge.bridgeError");
      }),
  );
  form.append(cancel);
  try {
    const context = await view.getContext();
    const config = configForStorage(context.extension.config);
    followTheme(config, () => view.theme.enable());
    let page: string;
    try {
      page = contentId(context.extension.content?.id);
    } catch {
      throw new Error(t("viewerForge.pageRequired"));
    }
    const fields = element("fieldset", "forge-fields");
    form.prepend(fields);
    const label = (text: string, input: HTMLElement) => {
      const row = element("label", `${input.dataset.testid}-label`, text);
      row.append(input);
      fields.append(row);
    };
    const picker = element("select", "forge-attachment");
    label(t("viewerForge.attachment"), picker);
    const simulations = element("select", "forge-simulation");
    label(t("viewerForge.simulation"), simulations);
    const height = element("select", "forge-height");
    height.add(new Option(t("viewerForge.autoHeight"), "0"));
    for (const value of [...new Set([200, 300, 380, 480, 600, 800, 1200, 1600, config.height])]
      .filter(Boolean)
      .sort((a, b) => a - b))
      height.add(new Option(t("viewerForge.heightPixels", { height: value }), String(value)));
    height.value = String(config.height);
    label(t("viewerForge.height"), height);
    const theme = element("select", "forge-theme");
    theme.add(new Option(t("viewerForge.autoTheme"), "auto"));
    theme.add(new Option(t("viewerForge.light"), "light"));
    theme.add(new Option(t("viewerForge.dark"), "dark"));
    theme.value = config.theme;
    label(t("viewerForge.theme"), theme);
    const file = element("input", "forge-file");
    file.type = "file";
    file.accept = ".livediagram.json,application/json";
    label(t("viewerForge.file"), file);
    const help = element("p", "forge-upload-help", t("viewerForge.uploadHelp"));
    fields.append(help);
    const upload = element("button", "forge-upload", t("viewerForge.upload"));
    const replace = element("button", "forge-replace", t("viewerForge.replace"));
    upload.type = replace.type = "button";
    fields.append(upload, replace);
    const save = element("button", "forge-save", t("viewerForge.save"));
    save.type = "submit";
    fields.append(save);
    // Always available, including when the page or attachment request fails.
    let attachments: Attachment[] = [];
    let valid = false;
    let simulationIds = new Set<string>();
    const refreshButtons = () => {
      save.disabled = !valid;
      upload.disabled = !file.files?.length;
      replace.disabled = !file.files?.length || !picker.value;
    };
    file.addEventListener("change", refreshButtons);
    simulations.addEventListener("change", () => {
      valid = simulationIds.has(simulations.value);
      if (valid) {
        status.textContent = "";
        status.setAttribute("role", "status");
      }
      refreshButtons();
    });
    const busy = async (task: () => Promise<void>) => {
      const focused =
        document.activeElement instanceof HTMLElement && fields.contains(document.activeElement)
          ? document.activeElement
          : null;
      let movedFocus = false;
      const onFocus = (event: FocusEvent) => {
        if (event.target !== document.body) movedFocus = true;
      };
      fields.disabled = true;
      document.addEventListener("focusin", onFocus);
      status.setAttribute("role", "status");
      status.textContent = t("viewerForge.loading");
      try {
        await task();
        status.textContent = "";
      } catch (error) {
        status.setAttribute("role", "alert");
        status.textContent = errorMessage(error);
      } finally {
        fields.disabled = false;
        refreshButtons();
        document.removeEventListener("focusin", onFocus);
        if (!movedFocus && focused && document.activeElement === document.body) focused.focus();
      }
    };
    const readSelection = async (simulation = "") => {
      valid = false;
      simulationIds = new Set();
      simulations.replaceChildren(new Option(t("viewerForge.freePlay"), ""));
      if (!picker.value) return;
      const diagram = await downloadDiagram(requestConfluence, page, picker.value);
      simulationIds = new Set(["", ...(diagram.simulations ?? []).map((sim) => sim.id)]);
      for (const sim of diagram.simulations ?? []) simulations.add(new Option(sim.title, sim.id));
      if (simulation && !diagram.simulations?.some((s) => s.id === simulation)) {
        simulations.add(new Option(t("viewerForge.missingSimulation"), simulation));
        simulations.value = simulation;
        throw new Error(t("viewerForge.missingSimulation"));
      }
      simulations.value = simulation;
      valid = true;
    };
    picker.addEventListener("change", () => void busy(() => readSelection()));
    const send = (replacing: boolean) =>
      busy(async () => {
        const selectedFile = file.files?.[0];
        if (!selectedFile) return;
        const selected = attachments.find((a) => a.id === picker.value);
        if (replacing && !selected) return;
        const attached = await uploadDiagram(requestConfluence, page, selectedFile, replacing ? selected : undefined);
        attachments = await listAttachments(requestConfluence, page);
        fillPicker(attached.id);
        await readSelection();
        file.value = "";
      }).then(() => {
        if (status.getAttribute("role") !== "alert") status.textContent = t("viewerForge.uploaded");
      });
    upload.addEventListener("click", () => void send(false));
    replace.addEventListener("click", () => void send(true));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!valid) return;
      void busy(async () => {
        try {
          await view.submit({
            config: configForStorage({
              attachmentId: picker.value,
              simulation: simulations.value,
              height: Number(height.value),
              theme: theme.value,
            }),
          });
        } catch {
          throw new Error(t("viewerForge.saveError"));
        }
      });
    });
    const fillPicker = (selected: string) => {
      picker.replaceChildren(new Option(t("viewerForge.choose"), ""));
      for (const attachment of attachments) picker.add(new Option(attachment.title, attachment.id));
      picker.value = selected;
    };
    await busy(async () => {
      attachments = await listAttachments(requestConfluence, page);
      fillPicker(config.attachmentId);
      await readSelection(config.simulation);
    });
  } catch (error) {
    status.setAttribute("role", "alert");
    status.textContent = errorMessage(error);
  }
}

void main();
