import type { AnnotationShape } from "../../model/types";

// Syntax lives with the format, independent of the canvas catalog and its display messages.
export type MermaidShape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "asym"
  | "rhombus"
  | "hexagon"
  | "parallelogram"
  | "trapezoid";
interface ShapeSyntax {
  shape: string;
  importAs: MermaidShape;
  brackets?: readonly [string, string];
  aliases?: readonly string[];
}
export const MERMAID_SHAPES: Record<AnnotationShape, ShapeSyntax> = {
  rect: { shape: "rect", importAs: "rect", brackets: ["[", "]"] },
  rounded: { shape: "rounded", importAs: "round", brackets: ["(", ")"] },
  ellipse: {
    shape: "circle",
    importAs: "circle",
    brackets: ["((", "))"],
    aliases: ["ellipse", "circ", "sm-circ", "small-circle", "start"],
  },
  diamond: { shape: "diamond", importAs: "rhombus", brackets: ["{", "}"], aliases: ["rhombus", "decision"] },
  cylinder: { shape: "cylinder", importAs: "cylinder", brackets: ["[(", ")]"], aliases: ["cyl", "database", "db"] },
  stadium: { shape: "stadium", importAs: "stadium", brackets: ["([", "])"], aliases: ["pill"] },
  subroutine: { shape: "subroutine", importAs: "subroutine", brackets: ["[[", "]]"], aliases: ["subproc"] },
  "dbl-circ": { shape: "dbl-circ", importAs: "circle", brackets: ["(((", ")))"], aliases: ["double-circle"] },
  hexagon: { shape: "hexagon", importAs: "hexagon", brackets: ["{{", "}}"], aliases: ["hex"] },
  "lean-r": { shape: "lean-r", importAs: "parallelogram", brackets: ["[/", "/]"], aliases: ["parallelogram"] },
  "lean-l": { shape: "lean-l", importAs: "parallelogram", brackets: ["[\\", "\\]"] },
  "trap-b": { shape: "trap-b", importAs: "trapezoid", brackets: ["[/", "\\]"], aliases: ["trapezoid"] },
  "trap-t": { shape: "trap-t", importAs: "trapezoid", brackets: ["[\\", "/]"] },
  "sl-rect": { shape: "sl-rect", importAs: "rect", aliases: ["manual-input"] },
  "notch-rect": { shape: "notch-rect", importAs: "rect", aliases: ["card"] },
  "lin-rect": { shape: "lin-rect", importAs: "rect" },
  "div-rect": { shape: "div-rect", importAs: "rect" },
  "tag-rect": { shape: "tag-rect", importAs: "rect" },
  processes: { shape: "processes", importAs: "rect", aliases: ["procs"] },
  delay: { shape: "delay", importAs: "round" },
  "notch-pent": { shape: "notch-pent", importAs: "rect" },
  hourglass: { shape: "hourglass", importAs: "rhombus" },
  fork: { shape: "fork", importAs: "rect" },
  datastore: { shape: "datastore", importAs: "cylinder" },
  das: { shape: "das", importAs: "cylinder" },
  "lin-cyl": { shape: "lin-cyl", importAs: "cylinder" },
  "bow-rect": { shape: "bow-rect", importAs: "rect" },
  flag: { shape: "flag", importAs: "asym", aliases: ["paper-tape"] },
  "win-pane": { shape: "win-pane", importAs: "rect" },
  doc: { shape: "doc", importAs: "rect", aliases: ["document"] },
  docs: { shape: "docs", importAs: "rect", aliases: ["documents"] },
  "lin-doc": { shape: "lin-doc", importAs: "rect" },
  "tag-doc": { shape: "tag-doc", importAs: "rect" },
  bolt: { shape: "bolt", importAs: "asym", aliases: ["lightning"] },
  comment: { shape: "comment", importAs: "rect" },
  "brace-r": { shape: "brace-r", importAs: "rect" },
  braces: { shape: "braces", importAs: "rect" },
  "curv-trap": { shape: "curv-trap", importAs: "trapezoid", aliases: ["display"] },
  asym: { shape: "asym", importAs: "asym", brackets: [">", "]"], aliases: ["odd"] },
  "f-circ": { shape: "f-circ", importAs: "circle" },
  "framed-circle": { shape: "framed-circle", importAs: "circle" },
  "cross-circ": { shape: "cross-circ", importAs: "circle" },
  tri: { shape: "tri", importAs: "rect", aliases: ["triangle"] },
  "flip-tri": { shape: "flip-tri", importAs: "rect" },
};
export const MERMAID_BRACKETS = Object.values(MERMAID_SHAPES)
  .filter((s): s is ShapeSyntax & { brackets: readonly [string, string] } => !!s.brackets)
  .sort((a, b) => b.brackets[0].length - a.brackets[0].length);
export const MERMAID_ALIASES = new Map(
  Object.entries(MERMAID_SHAPES).flatMap(([id, s]) =>
    [id, s.shape, ...(s.aliases ?? [])].map((alias) => [alias, s.importAs] as const),
  ),
);
