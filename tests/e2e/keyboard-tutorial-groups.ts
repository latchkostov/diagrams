import { tutorialEntries } from "../../src/tutorials/catalog/ids";
import { keyboardExceptions } from "../../src/tutorials/keyboard";

// Keep whole-file CI shards bounded while preserving every lesson and its exact driver.
const lessons = tutorialEntries.filter((entry) => !keyboardExceptions[entry.id]);
export const keyboardTutorialGroups = Array.from({ length: 6 }, (_, part) =>
  lessons.filter((_, index) => index % 6 === part).map(({ id }) => id),
);
