import { msg } from "../i18n";

/** Stable track keys own chapter identity; adding a chapter never renumbers stored awards. */
export const chapters = {
  basics: {
    id: "basics",
    order: 1,
    numeral: "I",
    seal: "chapter-basics",
    label: msg("tutorials.trackBasics"),
    blurb: msg("tutorials.syllabus.blurbBasics"),
  },
  blocks: {
    id: "blocks",
    order: 2,
    numeral: "II",
    seal: "chapter-blocks",
    label: msg("tutorials.trackBlocks"),
    blurb: msg("tutorials.syllabus.blurbBlocks"),
  },
  simulation: {
    id: "simulation",
    order: 3,
    numeral: "III",
    seal: "chapter-simulation",
    label: msg("tutorials.trackSimulation"),
    blurb: msg("tutorials.syllabus.blurbSimulation"),
  },
  waiting: {
    id: "waiting",
    order: 4,
    numeral: "IV",
    seal: "chapter-waiting",
    label: msg("tutorials.trackWaiting"),
    blurb: msg("tutorials.syllabus.blurbWaiting"),
  },
  resilience: {
    id: "resilience",
    order: 5,
    numeral: "V",
    seal: "chapter-resilience",
    label: msg("tutorials.trackResilience"),
    blurb: msg("tutorials.syllabus.blurbResilience"),
  },
  studies: {
    id: "studies",
    order: 6,
    numeral: "VI",
    seal: "chapter-studies",
    label: msg("tutorials.trackStudies"),
    blurb: msg("tutorials.syllabus.blurbStudies"),
  },
  sharing: {
    id: "sharing",
    order: 7,
    numeral: "VII",
    seal: "chapter-sharing",
    label: msg("tutorials.trackSharing"),
    blurb: msg("tutorials.syllabus.blurbSharing"),
  },
} as const;

export const tracks = Object.values(chapters).sort((a, b) => a.order - b.order);
export type TrackId = keyof typeof chapters;
