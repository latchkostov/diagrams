import { expect, it } from "vitest";
import { allTutorials, tutorials } from "./catalog";
import { tutorialEntries } from "./catalog/ids";
import { tutorialMetadata } from "./metadata";

// Quarantine's hiding and progress behaviour is covered against an isolated fixture: quarantineFixture.test.tsx.
it("the real catalog quarantines no lesson: every one is published, listed and in the generated tests", () => {
  expect(allTutorials.filter((t) => t.quarantined).map((t) => t.id)).toEqual([]);
  expect(tutorials).toEqual(allTutorials);
  expect(tutorialEntries.filter((entry) => entry.quarantined)).toEqual([]);
  expect(tutorialMetadata.map((t) => t.id)).toEqual(allTutorials.map((t) => t.id));
});
