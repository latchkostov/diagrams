import { expect, it } from "vitest";
import { chapters, tracks } from "./chapters";
import { tutorials } from "./catalog";
import { lessonNumber } from "./handoff";
import { chapterSeals, earnedSeals } from "./seals";
import { recordSeals, withoutProgress } from "./progress";

it("includes the six caching lessons in chapter counts, numbering, seals and scoped reset", () => {
  expect(tracks.map((track) => tutorials.filter((lesson) => lesson.track === track.id).length)).toEqual([
    14, 14, 11, 8, 11, 6, 4,
  ]);
  const ids = [
    "cdn-cache",
    "derived-hit-ratio",
    "cache-latency",
    "cache-stampede",
    "stale-while-revalidate",
    "cold-cache",
  ];
  expect(
    ids.map((id) =>
      lessonNumber(
        tutorials.find((t) => t.id === id)!,
        tutorials,
      ),
    ),
  ).toEqual(["2.6", "3.2", "4.1", "5.1", "5.2", "5.3"]);
  const progress = Object.fromEntries(
    tutorials.map((t) => [t.id, { version: t.version, step: t.steps.length, completed: true }]),
  );
  for (const id of ids) {
    const partial = { progress: { ...progress, [id]: { ...progress[id], completed: false } } };
    expect(earnedSeals(partial, tutorials)).not.toContain("whole-syllabus");
    const track = tutorials.find((t) => t.id === id)!.track;
    expect(earnedSeals(partial, tutorials)).not.toContain(chapters[track].seal);
    const reset = withoutProgress(
      { progress, marks: { [chapters[track].seal]: 123, "whole-syllabus": 456 } },
      { lesson: id },
      tutorials,
    );
    expect(reset.progress?.[id]).toBeUndefined();
    expect(reset.progress?.["cache-aside"]).toEqual(progress["cache-aside"]);
    expect(earnedSeals(reset, tutorials)).not.toContain("whole-syllabus");
  }
});

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
