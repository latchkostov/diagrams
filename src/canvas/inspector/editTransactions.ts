/** A fresh undo tag per click: one bulk change is one undo step, and the next click is another. */
let bulkSeq = 0;

export const bulkStep = (what: string) => ({ merge: `bulk:${what}:${++bulkSeq}` });
