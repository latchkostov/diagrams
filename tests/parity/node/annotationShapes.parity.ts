import { it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { annotationShapesFixture } from "../../../src/lab/annotationShapesFixture";
import { ShapeOutline } from "../../../src/canvas/nodes/ShapeOutline";
import { diagramToMermaid } from "../../../src/interop/mermaid/write";
import { parseMermaid } from "../../../src/interop/mermaid/read";
import { diagramToDrawio } from "../../../src/interop/drawio/write";
import { expectGolden, expectGoldenText } from "../lib/golden";

it("pins all annotation outlines and their interchange syntax", () => {
  const diagram = annotationShapesFixture();
  expectGolden("annotation-shapes/annotations.json", diagram.annotations);
  expectGoldenText(
    "annotation-shapes/outlines.svg",
    (diagram.annotations ?? [])
      .map((a) =>
        renderToStaticMarkup(createElement(ShapeOutline, { shape: a.shape ?? "rect", w: a.width, h: a.height })),
      )
      .join("\n"),
  );
  expectGoldenText("annotation-shapes/drawio.drawio", diagramToDrawio(diagram));
  const mermaid = diagramToMermaid(diagram, { metadata: false });
  expectGoldenText("annotation-shapes/mermaid.mmd", mermaid);
  const back = parseMermaid(mermaid);
  expectGolden("annotation-shapes/mermaid-read.json", back);
});
