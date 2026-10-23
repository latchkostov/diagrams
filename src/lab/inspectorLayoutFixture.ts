import type { DiagramFile } from "../model/types";
import { resilienceFixture } from "./resilienceFixture";

/** An invented small system for Inspector rhythm, responsive pairs and summaries. */
export function inspectorLayoutFixture(): DiagramFile {
  const d = resilienceFixture();
  d.title = "Inspector layout";
  d.nodes[1].props = { ...d.nodes[1].props, replicas: 4, concurrency: 100 };
  d.edges[1].props = {
    ...d.edges[1].props,
    caller: { ...(d.edges[1].props?.caller as object), deadlineMs: 300 },
  };
  d.groups = [{ id: "commerce", label: "Commerce", x: -40, y: 120, width: 310, height: 200 }];
  return d;
}
