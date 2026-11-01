import { expect, it } from "vitest";
import { chapters, tracks } from "./chapters";
import { tutorials } from "./catalog";
import { lessonNumber } from "./handoff";
import { chapterSeals, earnedSeals } from "./seals";
import { recordSeals, withoutProgress } from "./progress";

it("derives order, numbering and seal identity from seven keyed descriptors", () => {
  expect(tracks).toHaveLength(7);
  expect(tracks.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(new Set(tracks.map((c) => c.seal)).size).toBe(tracks.length);
  for (const track of tracks) {
    expect(chapters[track.id]).toBe(track);
    expect(chapterSeals.find((s) => s.track === track.id)).toEqual({
      id: track.seal,
      track: track.id,
      numeral: track.numeral,
    });
    const lesson = tutorials.find((lesson) => lesson.track === track.id)!;
    expect(lessonNumber(lesson, tutorials)).toBe(`${track.order}.1`);
  }
});
it("migrates old progress without redating retained seals when catalog versions or membership change", () => {
  const chapter = tutorials.filter((lesson) => lesson.track === "basics");
  const old = {
    highlights: false,
    marks: { "chapter-studies": 123 },
    progress: Object.fromEntries(
      chapter.map((lesson) => [lesson.id, { version: lesson.version, step: 0, completed: true }]),
    ),
  };
  const migrated = recordSeals(old, tutorials, 456);
  const changedCatalog = [
    ...tutorials.map((lesson) => ({ ...lesson, version: lesson.version + 1 })),
    { ...chapter[0], id: "future-lesson" },
  ];
  expect(recordSeals(migrated, changedCatalog, 789).marks).toEqual({ "chapter-studies": 123, "chapter-basics": 456 });
  expect(earnedSeals(migrated, changedCatalog)).toContain("chapter-basics");
  expect(migrated.progress).toEqual(old.progress);
  expect(withoutProgress(migrated, { track: "basics" }, changedCatalog).marks).toEqual({ "chapter-studies": 123 });
});
it("can reset a retained chapter award even when a new catalog has no lessons in that chapter", () => {
  expect(
    withoutProgress(
      { marks: { "chapter-basics": 100, "chapter-studies": 200, "whole-syllabus": 300 } },
      { track: "basics" },
      [],
    ).marks,
  ).toEqual({ "chapter-studies": 200 });
});
