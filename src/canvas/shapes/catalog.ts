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

function defineShape(id: AnnotationShape, category: ShapeCategory, keywords: string): ShapeDefinition {
  return {
    id,
    get label() {
      return shapeLabel[id];
    },
    category,
    keywords,
  };
}

export const SHAPES_CATALOG: readonly ShapeDefinition[] = [
  defineShape("rect", "basic", "rectangle rect box process step action"),
  defineShape("rounded", "basic", "rounded rectangle event corner pill soft"),
  defineShape("ellipse", "basic", "ellipse circle oval round start stop terminal"),
  defineShape("diamond", "basic", "diamond rhombus decision condition branch check if"),
  defineShape("cylinder", "basic", "cylinder database db storage datastore data"),
  defineShape("stadium", "basic", "stadium pill capsule terminal start stop"),
  defineShape("subroutine", "basic", "subroutine subproc subprocess procedure pre-defined"),
  defineShape("dbl-circ", "basic", "double circle dbl-circ stop end terminal target"),
  defineShape("hexagon", "basic", "hexagon hex prepare conditional preparation"),
  defineShape("lean-r", "flowchart", "parallelogram lean right input output data io"),
  defineShape("lean-l", "flowchart", "parallelogram lean left input output data io alt"),
  defineShape("trap-b", "flowchart", "trapezoid base bottom priority action operation"),
  defineShape("trap-t", "flowchart", "trapezoid base top manual operation inverted"),
  defineShape("sl-rect", "flowchart", "manual input sloped rectangle user typing entry form"),
  defineShape("notch-rect", "flowchart", "card notched rectangle punched card ticket"),
  defineShape("lin-rect", "flowchart", "lined rectangle shaded process automated task"),
  defineShape("div-rect", "flowchart", "divided rectangle partitioned process module"),
  defineShape("tag-rect", "flowchart", "tagged rectangle folder file label process"),
  defineShape("processes", "flowchart", "multiple processes stacked composite batch"),
  defineShape("delay", "flowchart", "delay wait sleep lag pause half rounded"),
  defineShape("notch-pent", "flowchart", "loop limit pentagon iteration repeat for while"),
  defineShape("hourglass", "flowchart", "collate hourglass sort merge time wait"),
  defineShape("fork", "flowchart", "fork join synchronisation bar barrier parallel split"),
  defineShape("datastore", "storage", "datastore data store top bottom border cache disk"),
  defineShape("das", "storage", "direct access storage das drum horizontal cylinder disk"),
  defineShape("lin-cyl", "storage", "disk storage lined cylinder hard drive volume"),
  defineShape("bow-rect", "storage", "stored data bow tie storage buffer state"),
  defineShape("flag", "storage", "paper tape flag punched ribbon stream banner"),
  defineShape("win-pane", "storage", "internal storage window pane memory ram core"),
  defineShape("doc", "document", "document page file report paper printout"),
  defineShape("docs", "document", "multiple documents pages files pile stack batch"),
  defineShape("lin-doc", "document", "lined document invoice receipt text sheet"),
  defineShape("tag-doc", "document", "tagged document certificate ticket manifest signed"),
  defineShape("bolt", "connector", "communication link bolt lightning flash trigger event"),
  defineShape("comment", "connector", "comment curly brace left remark note explanation"),
  defineShape("brace-r", "connector", "comment curly brace right remark note annotation"),
  defineShape("braces", "connector", "double braces comment both sides group bracket"),
  defineShape("curv-trap", "connector", "display screen monitor terminal console curved"),
  defineShape("asym", "connector", "asymmetric odd bookmark ribbon pointer tag banner"),
  defineShape("f-circ", "connector", "filled circle junction connector point black dot"),
  defineShape("framed-circle", "connector", "framed circle bullseye ring end stop finish target"),
  defineShape("cross-circ", "connector", "crossed circle summary sum xor operator combine"),
  defineShape("tri", "connector", "triangle extract filter sort up delta pyramid"),
  defineShape("flip-tri", "connector", "inverted triangle flipped manual file merge down"),
];
