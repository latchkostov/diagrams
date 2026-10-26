import { expect, it } from "vitest";
import { allTutorials, tutorials } from "./catalog";
import { tutorialEntries } from "./catalog/ids";
import { tutorialMetadata } from "./metadata";

// Quarantine's hiding and progress behaviour is covered against an isolated fixture: quarantineFixture.test.tsx.
it("the real catalog quarantines only checkout, retaining it in the generated tests", () => {
  expect(allTutorials.filter((t) => t.quarantined).map((t) => t.id)).toEqual(["study-checkout"]);
  expect(tutorials).toEqual(allTutorials.filter((t) => t.id !== "study-checkout"));
  expect(tutorialEntries.filter((entry) => entry.quarantined)).toEqual([{ id: "study-checkout", quarantined: true }]);
  expect(tutorialMetadata.map((t) => t.id)).toEqual(tutorials.map((t) => t.id));
});
