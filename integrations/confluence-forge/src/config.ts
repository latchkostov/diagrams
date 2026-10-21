export interface MacroConfig {
  attachmentId: string;
  simulation: string;
  height: number;
  theme: "auto" | "light" | "dark";
}

export const DEFAULT_CONFIG: MacroConfig = { attachmentId: "", simulation: "", height: 0, theme: "auto" };

export function contentId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:att)?[1-9]\d{0,29}$/.test(value)) throw new Error("Invalid content reference");
  return value.replace(/^att/, "");
}

/** Construct an allowlisted record. Never spread bridge context, files or diagrams into configuration. */
export function configForStorage(value: unknown): MacroConfig {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  let attachmentId = "";
  try {
    attachmentId = contentId(input.attachmentId);
  } catch {
    /* Not configured yet. */
  }
  return {
    attachmentId,
    simulation: typeof input.simulation === "string" && input.simulation.length <= 200 ? input.simulation : "",
    height:
      typeof input.height === "number" && Number.isInteger(input.height) && input.height >= 200 && input.height <= 1600
        ? input.height
        : 0,
    theme: input.theme === "light" || input.theme === "dark" ? input.theme : "auto",
  };
}
