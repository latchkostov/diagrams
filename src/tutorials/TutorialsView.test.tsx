import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { TutorialsView } from "./TutorialsView";
import { mobileApi } from "./catalog/mobileApi";
import { savedProgress } from "./progress";

afterEach(() => vi.unstubAllGlobals());

it.each([-1, 0.5, null, "bad", 1000000])("keeps the hub usable with stored step %s", (step) => {
  const raw = JSON.stringify({ progress: { [mobileApi.id]: { version: mobileApi.version, step, completed: false } } });
  vi.stubGlobal("localStorage", { getItem: () => raw });
  const html = renderToStaticMarkup(<TutorialsView />);
  expect(html).toContain('data-testid="tutorials-resume"');
  expect(html).toContain('data-testid="tutorials-reset-basics"');
  expect(savedProgress(mobileApi)?.step).toBe(step === 1000000 ? step : 0);
});
