import { expect, it } from "vitest";
import { tracks, tutorials } from "./catalog";
import { justEarnedSeals, lessonNumber } from "./handoff";
import { nextTutorial, recordSeals, type StoredTutorials } from "./progress";

const ordered = tracks.flatMap((track) => tutorials.filter((lesson) => lesson.track === track.id));
function completed(list = ordered): StoredTutorials {
  return {
    progress: Object.fromEntries(
      list.map((lesson) => [lesson.id, { version: lesson.version, step: 0, completed: true }]),
    ),
  };
}

it("follows chapter order even when the catalog's tracks are interleaved", () => {
  for (let i = 0; i < ordered.length - 1; i++) {
    expect(nextTutorial(ordered[i], tutorials, {})).toBe(ordered[i + 1]);
  }
  expect(
    lessonNumber(
      ordered.find((lesson) => lesson.track === "blocks")!,
      tutorials,
    ),
  ).toBe("2.1");
});

it("skips done and quarantined lessons, but offers an unfinished current version", () => {
  const progress = completed([ordered[1]]);
  expect(nextTutorial(ordered[0], tutorials, progress)).toBe(ordered[2]);
  progress.progress![ordered[1].id].version--;
  expect(nextTutorial(ordered[0], tutorials, progress)).toBe(ordered[1]);
  expect(
    nextTutorial(
      ordered[0],
      tutorials.map((lesson) => (lesson.id === ordered[1].id ? { ...lesson, quarantined: true } : lesson)),
      {},
    ),
  ).toBe(ordered[2]);
});

it("wraps to earlier unfinished lessons and stops only at the end of the syllabus", () => {
  expect(nextTutorial(ordered.at(-1)!, tutorials, {})).toBe(ordered[0]);
  expect(nextTutorial(ordered.at(-1)!, tutorials, completed())).toBeUndefined();
  expect(nextTutorial(ordered[0], [ordered[0]], {})).toBeUndefined();
});

it("shows only newly earned chapter seals, once, including both final seals", () => {
  const basics = ordered.filter((lesson) => lesson.track === "basics");
  const before = completed(basics.slice(0, -1));
  const after = recordSeals(completed(basics), tutorials, 1000);
  expect(justEarnedSeals(before, after, tutorials)).toEqual(["chapter-basics"]);
  expect(justEarnedSeals(after, after, tutorials)).toEqual([]);
  expect(justEarnedSeals({ marks: { "chapter-basics": 500 } }, after, tutorials)).toEqual([]);
  expect(justEarnedSeals(completed(ordered.slice(0, -1)), recordSeals(completed(), tutorials), tutorials)).toEqual([
    "chapter-studies",
    "whole-syllabus",
  ]);
  expect(justEarnedSeals({}, completed([ordered[0]]), tutorials)).toEqual([]);
});
