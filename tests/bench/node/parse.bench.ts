// Opening and saving a diagram, without the browser (docs/BENCHMARKS.md § Metrics): the file text → parse, migrate
// and validate (parseNative: every open, import, autosave read and share link), the canvas's conversion to React
// Flow nodes and edges (toFlow) and back (fromFlow: the document the editor derives from the canvas), and writing
// the file (serializeNative: save, export, autosave).

import { fromFlow, toFlow } from "../../../src/canvas/convert";
import { parseNative, serializeNative } from "../../../src/interop/native";
import { FAMILY_IDS } from "../../../src/bench/workloads";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { serviceMesh } from "../../../src/bench/workloads/mesh";
import { cases, GATE_LARGE, GATE_SMALL, measure, samplesFor, suite, workload, workloadInfo } from "./harness";

const s = suite("parse");

for (const { family, n, title } of cases(FAMILY_IDS))
  s.timing(`parse and convert ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    const text = serializeNative(d);
    const samples = samplesFor(n);
    s.time(
      "serialize",
      measure(() => serializeNative(d), { samples }),
      w,
    );
    s.time(
      "parseNative",
      measure(() => parseNative(text), { samples }),
      w,
    );
    const flow = toFlow(d);
    s.time(
      "toFlow",
      measure(() => toFlow(d), { samples }),
      w,
    );
    s.time(
      "fromFlow",
      measure(() => fromFlow(flow.meta, flow.nodes, flow.edges), { samples }),
      w,
    );
    s.count("fileSize", text.length, { w, unit: "chars" });
  });

s.gating("opening a file grows linearly with the diagram", () => {
  const small = serializeNative(eventPipeline(GATE_SMALL));
  const large = serializeNative(eventPipeline(GATE_LARGE));
  s.growth(
    "parseNative",
    () => parseNative(small),
    () => parseNative(large),
  );
  const meshSmall = serializeNative(serviceMesh(GATE_SMALL));
  const meshLarge = serializeNative(serviceMesh(GATE_LARGE));
  s.growth(
    "parseNative-mesh",
    () => parseNative(meshSmall),
    () => parseNative(meshLarge),
  );
});

s.gating("converting to the canvas and back grows linearly", () => {
  const small = serviceMesh(GATE_SMALL);
  const large = serviceMesh(GATE_LARGE);
  s.growth(
    "toFlow",
    () => toFlow(small),
    () => toFlow(large),
  );
  const fs = toFlow(small);
  const fl = toFlow(large);
  s.growth(
    "fromFlow",
    () => fromFlow(fs.meta, fs.nodes, fs.edges),
    () => fromFlow(fl.meta, fl.nodes, fl.edges),
  );
});
