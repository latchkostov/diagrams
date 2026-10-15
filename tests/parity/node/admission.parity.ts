// Planning P3's vendor presets (docs/SIMULATION.md, "Planning revision p3"): the published preset revision and its
// scoped budgets, and which stencils are managed (serverless or API) and which preset each starts with. The p3
// corpus diagrams (tests/parity/corpus/p3-*) pin admission in playback, analysis and explanations.
import { it } from "vitest";
import {
  ADMISSION_PRESETS,
  ADMISSION_REVISION,
  admissionPresetFor,
  managedKind,
} from "../../../src/model/admissionPresets";
import { newPlanningProps } from "../../../src/model/planning";
import { catalog } from "../../../src/stencils/catalog";
import { stencilRole } from "../../../src/stencils/roles";
import { expectGolden } from "../lib/golden";

it("admission presets", () => {
  const managed = catalog
    .filter((s) => managedKind(s.id))
    .map((s) => [
      s.id,
      {
        kind: managedKind(s.id),
        preset: admissionPresetFor(s.id) ?? null,
        // What a new node of this stencil gets in a p3 diagram.
        newProps: newPlanningProps(stencilRole(s.id), { revision: "p3" }, s.id) ?? null,
      },
    ]);
  expectGolden("admission/presets.json", {
    revision: ADMISSION_REVISION,
    presets: ADMISSION_PRESETS,
    stencils: Object.fromEntries(managed),
  });
});
