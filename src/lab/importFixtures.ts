import type { DiagramFile } from "../model/types";
import { importCompose } from "../interop/infra/pipeline";
import composeFixture from "../../tests/fixtures/imports/compose/docker-compose.yml?raw";

// The infrastructure import fixtures (tests/fixtures/imports), imported the way Open… does, for the Lab: the
// overlap audit and a diagram to open in the editor. The Lab is a lazy chunk, so the YAML reader stays out of
// the startup JavaScript.

/** tests/fixtures/imports/compose/docker-compose.yml, imported. */
export function importedCompose(): DiagramFile {
  const outcome = importCompose([{ name: "docker-compose.yml", text: composeFixture }]);
  if (outcome.ok !== true) throw new Error(outcome.ok === false ? outcome.error : "unexpected outcome");
  return outcome.diagram;
}
