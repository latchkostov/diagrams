import { loadShapeGeometry, loadShapeAttachments } from "../../../src/canvas/shapes/runtime";
import { beforeAll, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { annotationShapesFixture } from "../../../src/lab/annotationShapesFixture";
import { ShapeOutline } from "../../../src/canvas/nodes/ShapeOutline";
import { diagramToMermaid } from "../../../src/interop/mermaid/write";
import { parseMermaid } from "../../../src/interop/mermaid/read";
import { diagramToDrawio } from "../../../src/interop/drawio/write";
import { expectGolden, expectGoldenText } from "../lib/golden";
import { shapeAttachment } from "../../../src/canvas/shapes/attachment";

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
  expectGoldenText(
    "annotation-shapes/narrow-delay.svg",
    renderToStaticMarkup(createElement(ShapeOutline, { shape: "delay", w: 40, h: 100 })),
  );
  expectGolden(
    "annotation-shapes/attachments.json",
    (diagram.annotations ?? [])
      .filter((a) => a.id.startsWith("outline-"))
      .map((a) => ({
        shape: a.shape,
        sizes: [
          [160, 90],
          [40, 100],
          [400, 90],
        ].map(([width, height]) => ({
          width,
          height,
          ports: Object.fromEntries(
            (["top", "right", "bottom", "left"] as const).map((side) => [
              side,
              [-7, 0, 7].map((offset) => {
                const p = shapeAttachment(a.shape ?? "rect", width, height, side, offset);
                return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
              }),
            ]),
          ),
        })),
      })),
  );
  expectGoldenText("annotation-shapes/drawio.drawio", diagramToDrawio(diagram));
  const mermaid = diagramToMermaid(diagram, { metadata: false });
  expectGoldenText("annotation-shapes/mermaid.mmd", mermaid);
  const back = parseMermaid(mermaid);
  expectGolden("annotation-shapes/mermaid-read.json", back);
});

beforeAll(async () => {
  await Promise.all([loadShapeGeometry(), loadShapeAttachments()]);
});
