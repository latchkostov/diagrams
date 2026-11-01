import { tutorialEntries } from "../../src/tutorials/catalog/ids";
// Keep both paths for every lesson, with existing quarantine metadata, in bounded whole-file shards.
export const pointerTutorialGroups = Array.from({ length: 4 }, (_, part) =>
  tutorialEntries.filter((_, index) => index % 4 === part),
);
