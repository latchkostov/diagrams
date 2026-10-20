import type { AnnotationShape } from "../../model/types";
import { t } from "../../i18n";
import { shapeLabel } from "../../i18n/chrome";
import type { ShapeCategory, ShapeDefinition } from "./types";
export type { ShapeCategory, ShapeDefinition };

export const SHAPE_CATEGORY_ORDER: readonly ShapeCategory[] = [
  "basic",
  "flowchart",
  "storage",
  "document",
  "connector",
];

export const shapeCategoryLabel: Record<ShapeCategory, string> = {
  get basic() {
    return t("shape.categoryBasic");
  },
  get flowchart() {
    return t("shape.categoryFlowchart");
  },
  get storage() {
    return t("shape.categoryStorage");
  },
  get document() {
    return t("shape.categoryDocument");
  },
  get connector() {
    return t("shape.categoryConnector");
  },
};

export const SHAPES_CATALOG: readonly ShapeDefinition[] = [
  // --- Basic Shapes ---
  {
    id: "rect",
    get label() {
      return shapeLabel.rect;
    },
    category: "basic",
    keywords: "rectangle rect box process step action",
    mermaidBracket: ["[", "]"],
    mermaidShape: "rect",
    drawioStyle: "rounded=0;",
  },
  {
    id: "rounded",
    get label() {
      return shapeLabel.rounded;
    },
    category: "basic",
    keywords: "rounded rectangle event corner pill soft",
    mermaidBracket: ["(", ")"],
    mermaidShape: "rounded",
    drawioStyle: "rounded=1;arcSize=10;",
  },
  {
    id: "ellipse",
    get label() {
      return shapeLabel.ellipse;
    },
    category: "basic",
    keywords: "ellipse circle oval round start stop terminal",
    mermaidBracket: ["((", "))"],
    mermaidShape: "circle",
    mermaidAliases: ["ellipse", "circ", "sm-circ", "small-circle", "start"],
    drawioStyle: "ellipse;",
  },
  {
    id: "diamond",
    get label() {
      return shapeLabel.diamond;
    },
    category: "basic",
    keywords: "diamond rhombus decision condition branch check if",
    mermaidBracket: ["{", "}"],
    mermaidShape: "diamond",
    mermaidAliases: ["rhombus", "decision"],
    drawioStyle: "rhombus;",
  },
  {
    id: "cylinder",
    get label() {
      return shapeLabel.cylinder;
    },
    category: "basic",
    keywords: "cylinder database db storage datastore data",
    mermaidBracket: ["[(", ")]"],
    mermaidShape: "cylinder",
    mermaidAliases: ["cyl", "database", "db"],
    drawioStyle: "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;",
  },
  {
    id: "stadium",
    get label() {
      return shapeLabel.stadium;
    },
    category: "basic",
    keywords: "stadium pill capsule terminal start stop",
    mermaidBracket: ["([", "])"],
    mermaidShape: "stadium",
    mermaidAliases: ["pill"],
    drawioStyle: "shape=ext;rounded=1;arcSize=50;",
  },
  {
    id: "subroutine",
    get label() {
      return shapeLabel.subroutine;
    },
    category: "basic",
    keywords: "subroutine subproc subprocess procedure pre-defined",
    mermaidBracket: ["[[", "]]"],
    mermaidShape: "subroutine",
    mermaidAliases: ["subproc"],
    drawioStyle: "shape=process;backgroundOutline=1;",
  },
  {
    id: "dbl-circ",
    get label() {
      return shapeLabel["dbl-circ"];
    },
    category: "basic",
    keywords: "double circle dbl-circ stop end terminal target",
    mermaidBracket: ["(((", ")))"],
    mermaidShape: "dbl-circ",
    mermaidAliases: ["double-circle"],
    drawioStyle: "shape=doubleEllipse;",
  },
  {
    id: "hexagon",
    get label() {
      return shapeLabel.hexagon;
    },
    category: "basic",
    keywords: "hexagon hex prepare conditional preparation",
    mermaidBracket: ["{{", "}}"],
    mermaidShape: "hexagon",
    mermaidAliases: ["hex"],
    drawioStyle: "shape=hexagon;perimeter=hexagonPerimeter2;",
  },

  // --- Flowchart & Process ---
  {
    id: "lean-r",
    get label() {
      return shapeLabel["lean-r"];
    },
    category: "flowchart",
    keywords: "parallelogram lean right input output data io",
    mermaidBracket: ["[/", "/]"],
    mermaidShape: "lean-r",
    mermaidAliases: ["parallelogram"],
    drawioStyle: "shape=parallelogram;perimeter=parallelogramPerimeter;",
  },
  {
    id: "lean-l",
    get label() {
      return shapeLabel["lean-l"];
    },
    category: "flowchart",
    keywords: "parallelogram lean left input output data io alt",
    mermaidBracket: ["[\\", "\\]"],
    mermaidShape: "lean-l",
    drawioStyle: "shape=parallelogram;perimeter=parallelogramPerimeter;flipH=1;",
  },
  {
    id: "trap-b",
    get label() {
      return shapeLabel["trap-b"];
    },
    category: "flowchart",
    keywords: "trapezoid base bottom priority action operation",
    mermaidBracket: ["[/", "\\]"],
    mermaidShape: "trap-b",
    mermaidAliases: ["trapezoid"],
    drawioStyle: "shape=trapezoid;perimeter=trapezoidPerimeter;",
  },
  {
    id: "trap-t",
    get label() {
      return shapeLabel["trap-t"];
    },
    category: "flowchart",
    keywords: "trapezoid base top manual operation inverted",
    mermaidBracket: ["[\\", "/]"],
    mermaidShape: "trap-t",
    drawioStyle: "shape=trapezoid;perimeter=trapezoidPerimeter;flipV=1;",
  },
  {
    id: "sl-rect",
    get label() {
      return shapeLabel["sl-rect"];
    },
    category: "flowchart",
    keywords: "manual input sloped rectangle user typing entry form",
    mermaidShape: "sl-rect",
    mermaidAliases: ["manual-input"],
    drawioStyle: "shape=manualInput;",
  },
  {
    id: "notch-rect",
    get label() {
      return shapeLabel["notch-rect"];
    },
    category: "flowchart",
    keywords: "card notched rectangle punched card ticket",
    mermaidShape: "notch-rect",
    mermaidAliases: ["card"],
    drawioStyle: "shape=card;",
  },
  {
    id: "lin-rect",
    get label() {
      return shapeLabel["lin-rect"];
    },
    category: "flowchart",
    keywords: "lined rectangle shaded process automated task",
    mermaidShape: "lin-rect",
    drawioStyle: "shape=process;dashed=1;",
  },
  {
    id: "div-rect",
    get label() {
      return shapeLabel["div-rect"];
    },
    category: "flowchart",
    keywords: "divided rectangle partitioned process module",
    mermaidShape: "div-rect",
    drawioStyle: "shape=process;",
  },
  {
    id: "tag-rect",
    get label() {
      return shapeLabel["tag-rect"];
    },
    category: "flowchart",
    keywords: "tagged rectangle folder file label process",
    mermaidShape: "tag-rect",
    drawioStyle: "shape=folder;",
  },
  {
    id: "processes",
    get label() {
      return shapeLabel.processes;
    },
    category: "flowchart",
    keywords: "multiple processes stacked composite batch",
    mermaidShape: "processes",
    mermaidAliases: ["procs"],
    drawioStyle: "shape=processes;",
  },
  {
    id: "delay",
    get label() {
      return shapeLabel.delay;
    },
    category: "flowchart",
    keywords: "delay wait sleep lag pause half rounded",
    mermaidShape: "delay",
    drawioStyle: "shape=delay;",
  },
  {
    id: "notch-pent",
    get label() {
      return shapeLabel["notch-pent"];
    },
    category: "flowchart",
    keywords: "loop limit pentagon iteration repeat for while",
    mermaidShape: "notch-pent",
    drawioStyle: "shape=loopLimit;",
  },
  {
    id: "hourglass",
    get label() {
      return shapeLabel.hourglass;
    },
    category: "flowchart",
    keywords: "collate hourglass sort merge time wait",
    mermaidShape: "hourglass",
    drawioStyle: "shape=collate;",
  },
  {
    id: "fork",
    get label() {
      return shapeLabel.fork;
    },
    category: "flowchart",
    keywords: "fork join synchronisation bar barrier parallel split",
    mermaidShape: "fork",
    drawioStyle: "shape=line;strokeWidth=4;",
  },

  // --- Data & Storage ---
  {
    id: "datastore",
    get label() {
      return shapeLabel.datastore;
    },
    category: "storage",
    keywords: "datastore data store top bottom border cache disk",
    mermaidShape: "datastore",
    drawioStyle: "shape=datastore;",
  },
  {
    id: "das",
    get label() {
      return shapeLabel.das;
    },
    category: "storage",
    keywords: "direct access storage das drum horizontal cylinder disk",
    mermaidShape: "das",
    drawioStyle: "shape=tapeData;",
  },
  {
    id: "lin-cyl",
    get label() {
      return shapeLabel["lin-cyl"];
    },
    category: "storage",
    keywords: "disk storage lined cylinder hard drive volume",
    mermaidShape: "lin-cyl",
    drawioStyle: "shape=cylinder3;",
  },
  {
    id: "bow-rect",
    get label() {
      return shapeLabel["bow-rect"];
    },
    category: "storage",
    keywords: "stored data bow tie storage buffer state",
    mermaidShape: "bow-rect",
    drawioStyle: "shape=dataStorage;",
  },
  {
    id: "flag",
    get label() {
      return shapeLabel.flag;
    },
    category: "storage",
    keywords: "paper tape flag punched ribbon stream banner",
    mermaidShape: "flag",
    mermaidAliases: ["paper-tape"],
    drawioStyle: "shape=tape;",
  },
  {
    id: "win-pane",
    get label() {
      return shapeLabel["win-pane"];
    },
    category: "storage",
    keywords: "internal storage window pane memory ram core",
    mermaidShape: "win-pane",
    drawioStyle: "shape=internalStorage;",
  },

  // --- Documents ---
  {
    id: "doc",
    get label() {
      return shapeLabel.doc;
    },
    category: "document",
    keywords: "document page file report paper printout",
    mermaidShape: "doc",
    mermaidAliases: ["document"],
    drawioStyle: "shape=document;",
  },
  {
    id: "docs",
    get label() {
      return shapeLabel.docs;
    },
    category: "document",
    keywords: "multiple documents pages files pile stack batch",
    mermaidShape: "docs",
    mermaidAliases: ["documents"],
    drawioStyle: "shape=documents;",
  },
  {
    id: "lin-doc",
    get label() {
      return shapeLabel["lin-doc"];
    },
    category: "document",
    keywords: "lined document invoice receipt text sheet",
    mermaidShape: "lin-doc",
    drawioStyle: "shape=document;dashed=1;",
  },
  {
    id: "tag-doc",
    get label() {
      return shapeLabel["tag-doc"];
    },
    category: "document",
    keywords: "tagged document certificate ticket manifest signed",
    mermaidShape: "tag-doc",
    drawioStyle: "shape=note;",
  },

  // --- Connectors & Decorators ---
  {
    id: "bolt",
    get label() {
      return shapeLabel.bolt;
    },
    category: "connector",
    keywords: "communication link bolt lightning flash trigger event",
    mermaidShape: "bolt",
    mermaidAliases: ["lightning"],
    drawioStyle: "shape=lightning;",
  },
  {
    id: "comment",
    get label() {
      return shapeLabel.comment;
    },
    category: "connector",
    keywords: "comment curly brace left remark note explanation",
    mermaidShape: "comment",
    drawioStyle: "shape=curlyBracket;",
  },
  {
    id: "brace-r",
    get label() {
      return shapeLabel["brace-r"];
    },
    category: "connector",
    keywords: "comment curly brace right remark note annotation",
    mermaidShape: "brace-r",
    drawioStyle: "shape=curlyBracket;flipH=1;",
  },
  {
    id: "braces",
    get label() {
      return shapeLabel.braces;
    },
    category: "connector",
    keywords: "double braces comment both sides group bracket",
    mermaidShape: "braces",
    drawioStyle: "shape=curlyBracket;",
  },
  {
    id: "curv-trap",
    get label() {
      return shapeLabel["curv-trap"];
    },
    category: "connector",
    keywords: "display screen monitor terminal console curved",
    mermaidShape: "curv-trap",
    mermaidAliases: ["display"],
    drawioStyle: "shape=display;",
  },
  {
    id: "asym",
    get label() {
      return shapeLabel.asym;
    },
    category: "connector",
    keywords: "asymmetric odd bookmark ribbon pointer tag banner",
    mermaidBracket: [">", "]"],
    mermaidShape: "asym",
    mermaidAliases: ["odd"],
    drawioStyle: "shape=singleArrow;",
  },
  {
    id: "f-circ",
    get label() {
      return shapeLabel["f-circ"];
    },
    category: "connector",
    keywords: "filled circle junction connector point black dot",
    mermaidShape: "f-circ",
    drawioStyle: "ellipse;fillColor=#1F2937;",
  },
  {
    id: "framed-circle",
    get label() {
      return shapeLabel["framed-circle"];
    },
    category: "connector",
    keywords: "framed circle bullseye ring end stop finish target",
    mermaidShape: "framed-circle",
    drawioStyle: "shape=doubleEllipse;",
  },
  {
    id: "cross-circ",
    get label() {
      return shapeLabel["cross-circ"];
    },
    category: "connector",
    keywords: "crossed circle summary sum xor operator combine",
    mermaidShape: "cross-circ",
    drawioStyle: "shape=xor;",
  },
  {
    id: "tri",
    get label() {
      return shapeLabel.tri;
    },
    category: "connector",
    keywords: "triangle extract filter sort up delta pyramid",
    mermaidShape: "tri",
    mermaidAliases: ["triangle"],
    drawioStyle: "shape=triangle;direction=north;",
  },
  {
    id: "flip-tri",
    get label() {
      return shapeLabel["flip-tri"];
    },
    category: "connector",
    keywords: "inverted triangle flipped manual file merge down",
    mermaidShape: "flip-tri",
    drawioStyle: "shape=triangle;direction=south;",
  },
];

export const shapeMap: ReadonlyMap<AnnotationShape, ShapeDefinition> = new Map(
  SHAPES_CATALOG.map((s) => [s.id, s]),
);
