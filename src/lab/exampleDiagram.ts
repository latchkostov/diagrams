import { getLoadedExample, loadExample } from "../examples";
import type { DiagramFile } from "../model/types";
import { notify } from "../interop/ui/toast";

const requests = new Map<string, Promise<void>>();
const failures = new Map<string, unknown>();

/** Lab render functions suspend only for the example used by the selected preview. */
export function exampleDiagram(slug: string): DiagramFile {
  const diagram = getLoadedExample(slug);
  if (diagram) return diagram;
  if (failures.has(slug)) throw failures.get(slug);
  let request = requests.get(slug);
  if (!request) {
    request = loadExample(slug).then(
      () => {
        requests.delete(slug);
      },
      (error: unknown) => {
        failures.set(slug, error);
        requests.delete(slug);
        notify("Couldn't load that example. Check your connection and reload the Lab.", { kind: "error" });
      },
    );
    requests.set(slug, request);
  }
  throw request;
}
