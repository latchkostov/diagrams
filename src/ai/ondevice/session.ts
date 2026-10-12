import { INITIAL_PROMPTS } from "./pipeline";
import { createModelSession, languageModel, type ModelSession } from "./promptApi";

// One primed session per page (the system prompt and examples), cloned for each request so retries share
// a request's context but requests don't pile up in one.

let primed: Promise<ModelSession> | null = null;

/** The primed session; the first call may start the model's download (needs a click or key press). */
export function primedSession(onProgress?: (loaded: number) => void): Promise<ModelSession> {
  const lm = languageModel();
  if (!lm) return Promise.reject(new Error("This browser has no built-in model."));
  primed ??= createModelSession(lm, INITIAL_PROMPTS, onProgress).catch((err: unknown) => {
    primed = null;
    throw err;
  });
  return primed;
}

/** Forget the primed session (tests, or after the browser drops the model). */
export function resetPrimedSession(): void {
  void primed?.then((s) => s.destroy()).catch(() => undefined);
  primed = null;
}
