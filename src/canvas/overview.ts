import { intersects, type Rect } from "./geometry/rect";
import { titleText } from "./identity";

export type OverviewItem = { id: string; name: string; box: Rect; group?: string; spotlight?: boolean };
export type OverviewHeader = OverviewItem & { lines: string[]; count: number };

/** Zone headers take a free band; individual cards always retain their own identity. */
export function overviewLayout(nodes: OverviewItem[], zones: OverviewItem[], measure: (text: string) => number) {
  const headers = zones.map((zone): OverviewHeader => {
    const lines: string[] = [];
    const width = Math.max(0, zone.box.width - 12);
    for (const word of zone.name.split(/\s+/)) {
      const fitted = titleText(word, width, measure);
      const last = lines.at(-1);
      if (last && measure(`${last} ${fitted}`) <= width) lines[lines.length - 1] += ` ${fitted}`;
      else {
        lines.push(measure(fitted) <= width ? fitted : "");
      }
    }
    const height = lines.length * 12 + 6;
    const box = { ...zone.box, height };
    const candidates = [zone.box.y, ...nodes.map((node) => node.box.y + node.box.height + 2)];
    const y = candidates.find(
      (y) =>
        y >= zone.box.y &&
        y + height <= zone.box.y + zone.box.height &&
        !nodes.some((node) => intersects({ ...box, y }, node.box)),
    );
    // Walk above every collision, including cards outside the zone.
    box.y = y ?? zone.box.y - height - 2;
    if (y === undefined) {
      for (;;) {
        const hit = nodes.find((node) => intersects(box, node.box));
        if (!hit) break;
        box.y = hit.box.y - height - 2;
      }
    }
    return { ...zone, count: 0, lines, box };
  });
  return { headers };
}

/** Live's decorator supplies the current-rate quartile; narration retains its adjacent routes. */
export function overviewConnection(near: boolean, main: boolean) {
  return near || main;
}
