import { getLoadedExample, loadExample } from "../examples";
import type { DiagramFile } from "../model/types";
import { notify } from "../interop/ui/toast";

/** A Lab preview whose example didn't download. The Lab's Retry clears it (resetExampleResource). */
export class ExampleLoadError extends Error {
  constructor(
    readonly slug: string,
    cause: unknown,
  ) {
    super("Couldn't load this example. Check your connection, then press Retry.", { cause });
    this.name = "ExampleLoadError";
  }
}

const requests = new Map<string, Promise<void>>();
// A failure is kept until Retry, so a render after it shows the error instead of downloading again
// in a loop. The shared loader (../examples) never caches failures, so the next request is fresh.
const failures = new Map<string, ExampleLoadError>();

/** Lab render functions suspend only for the example used by the selected preview. */
export function exampleDiagram(slug: string): DiagramFile {
  const diagram = getLoadedExample(slug);
  if (diagram) return diagram;
  const failure = failures.get(slug);
  if (failure) throw failure;
  let request = requests.get(slug);
  if (!request) {
    request = loadExample(slug).then(
      () => {
        requests.delete(slug);
      },
      (error: unknown) => {
        failures.set(slug, new ExampleLoadError(slug, error));
        requests.delete(slug);
        notify("Couldn't load that example. Check your connection, then press Retry.", { kind: "error" });
      },
    );
    requests.set(slug, request);
  }
  throw request;
}

/** Forgets a failed download, so the next render of that preview downloads it again. */
export function resetExampleResource(slug: string): void {
  failures.delete(slug);
}
