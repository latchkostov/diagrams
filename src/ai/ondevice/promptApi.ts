// Chrome's built-in model through the Prompt API (the `LanguageModel` global, Gemini Nano; stable for
// web pages since Chrome 148, desktop only). Feature-detected: without it nothing loads or shows. Only
// the parts the AI panel uses are typed here. Nothing leaves the device and there's no key.

export type ModelAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export interface PromptOptions {
  signal?: AbortSignal;
  responseConstraint?: object;
  omitResponseConstraintInput?: boolean;
}

export interface ModelSession {
  prompt(input: string, options?: PromptOptions): Promise<string>;
  clone?(options?: { signal?: AbortSignal }): Promise<ModelSession>;
  destroy(): void;
  readonly contextUsage?: number;
  readonly contextWindow?: number;
}

export type InitialPrompt = { role: "system" | "user" | "assistant"; content: string };

interface DownloadMonitor {
  addEventListener(type: "downloadprogress", listener: (e: { loaded: number }) => void): void;
}

export interface LanguageModelApi {
  availability(options?: object): Promise<ModelAvailability>;
  create(options?: {
    initialPrompts?: InitialPrompt[];
    signal?: AbortSignal;
    monitor?: (m: DownloadMonitor) => void;
    expectedInputs?: object[];
    expectedOutputs?: object[];
  }): Promise<ModelSession>;
}

/** English in and out: the model's languages must match at availability() and create(). */
export const MODEL_LANGUAGES = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

/** The Prompt API, when this browser has it. */
export function languageModel(scope: object = globalThis): LanguageModelApi | undefined {
  const lm = (scope as { LanguageModel?: Partial<LanguageModelApi> }).LanguageModel;
  return lm && typeof lm.availability === "function" && typeof lm.create === "function"
    ? (lm as LanguageModelApi)
    : undefined;
}

/** What the model can do here now; a browser that throws counts as "unavailable". */
export async function modelAvailability(lm = languageModel()): Promise<ModelAvailability> {
  if (!lm) return "unavailable";
  try {
    const a = await lm.availability(MODEL_LANGUAGES);
    return a === "available" || a === "downloadable" || a === "downloading" ? a : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * A session primed with the system prompt and examples. While the model isn't downloaded yet this
 * starts the download, which Chrome allows only right after a click or key press; `onProgress` gets 0–1.
 */
export function createModelSession(
  lm: LanguageModelApi,
  initialPrompts: InitialPrompt[],
  onProgress?: (loaded: number) => void,
): Promise<ModelSession> {
  return lm.create({
    ...MODEL_LANGUAGES,
    initialPrompts,
    ...(onProgress
      ? { monitor: (m: DownloadMonitor) => m.addEventListener("downloadprogress", (e) => onProgress(e.loaded)) }
      : {}),
  });
}
