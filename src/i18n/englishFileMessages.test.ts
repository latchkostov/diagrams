import { afterEach, describe, expect, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import en from "./en";
import { state, type Catalog } from "./index";
import { compile, parse } from "./icu";
import { helpersFor } from "./helpers";
import { fileFailure, importTooLarge, type FileFailureAction } from "../interop/ui/fileMessages";
import { graphError } from "../interop/storage/onedrive";
import { dropboxError } from "../interop/storage/dropbox";
import { formatBytes, formatImportTraffic, formatImportList } from "./format";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

/** The literals before File-dialog extraction, including wording that was deliberately count-invariant. */
const original: [keyof typeof en, Record<string, unknown>, string][] = [
  ["fileToast.linksOff", {}, "Share links are turned off here. Export Interactive HTML instead."],
  ["fileToast.linkOpenOff", {}, "Opening shared links is turned off here. Ask for the diagram file instead."],
  ["library.firstlastOfCountPluralOneDiagramOther", { first: "1", last: "20", count: 45 }, "1–20 of 45"],
  ["fileType.terraformPlan", {}, "Terraform plan"],
  ["importReport.drew", { nodes: 1, connections: 2, boundaries: 0 }, "Drew 1 node and 2 connections."],
  ["importReport.drew", { nodes: 2, connections: 1, boundaries: 1 }, "Drew 2 nodes, 1 connection and 1 boundary."],
  [
    "fileToast.exportedNodesPluralOneNodeOtherNodes",
    { nodes: 1, edges: 1 },
    "Exported 1 nodes and 1 edges. Anyone who has this file can open it.",
  ],
  ["fileDialog.diagramCounts", { nodes: 1, edges: 1, simulations: 1 }, "1 nodes, 1 edges, 1 simulation"],
  ["fileDialog.pagesSubtitle", { name: "a.drawio", count: 1 }, "“a.drawio” has 1 pages. Which one should open?"],
  [
    "importDetail.theseFilesHoldMoreThanValue0More",
    { value0: 1 },
    "These files hold more than 1 resources; one import reads at most that many.",
  ],
  ["importDetail.value0RunsUpToValue1Jobs", { value0: "worker", value1: 1 }, "worker runs up to 1 jobs at once (KEDA)"],
  [
    "importDetail.value0ScalesFromValue1ToValue2",
    { value0: "worker", value1: 0, value2: 1 },
    "worker scales from 0 to 1 replicas (KEDA)",
  ],
  [
    "importDetail.value0ScalesFromValue1ToValue2More",
    { value0: "worker", value1: 0, value2: 1 },
    "worker scales from 0 to 1 replicas (HorizontalPodAutoscaler)",
  ],
  ["importDetail.noBoundaryInItFitsIn", { value0: 1 }, "No boundary in it fits in 1 nodes, the most an import draws."],
  [
    "importDetail.itWouldDrawValue0NumberValue1",
    { value0: 1, value1: "nodes", value2: 0 },
    "It would draw 1 nodes; the most an import draws is 0.",
  ],
  [
    "importDetail.itWouldDrawValue0NumberValue1",
    { value0: 1, value1: "connections", value2: 0 },
    "It would draw 1 connections; the most an import draws is 0.",
  ],
  [
    "importDetail.itWouldDrawValue0NumberValue1",
    { value0: 1, value1: "boundaries", value2: 0 },
    "It would draw 1 boundaries; the most an import draws is 0.",
  ],
  ["importReport.unlisted", { count: 1 }, "1 more connections like these aren't listed"],
  ["importReport.overLimit", { count: 1, limit: "0" }, "1 nodes ticked, over the 0 an import draws: untick some."],
  ["importReport.alreadyDrawn", { count: 1 }, "1 nodes ticked: these are drawn."],
  ["importReport.ticked", { count: 1 }, "1 nodes ticked."],
  [
    "importReport.pickLede",
    { count: 1 },
    "It has 1 nodes, more than a diagram reads well, so only some boundaries are drawn. The ones with the most flows come first; tick others to draw them as a new diagram.",
  ],
  [
    "htmlExport.encryptsTheWholeDiagramTitleIncludedOnly",
    {},
    "Encrypts the whole diagram, title included; only the file’s size shows. The password is never stored or sent and can’t be recovered: if it’s lost, export again.",
  ],
];

describe("File extraction preserves the original English", () => {
  it.each(original)("%s with %j", (key, values, expected) => {
    const compiled = new Function("h", "return " + compile(parse(en[key])))(helpersFor("en")) as
      string | ((values: Record<string, unknown>) => string);
    expect(typeof compiled === "string" ? compiled : compiled(values)).toBe(expected);
  });

  it("cloud and image failures keep the operation's destination or format", () => {
    const failures: [FileFailureAction, string][] = [
      [{ action: "saveProvider", name: "Test storage" }, "Couldn't save to Test storage. Refused."],
      [{ action: "openProvider", name: "Test storage" }, "Couldn't open from Test storage. Refused."],
      [{ action: "image", name: "PNG" }, "Couldn't export the PNG. Refused."],
      [{ action: "image", name: "SVG" }, "Couldn't export the SVG. Refused."],
      ["save", "Couldn't save the file. Refused."],
      ["open", "Couldn't open the file. Refused."],
    ];
    for (const [action, expected] of failures) expect(fileFailure(action, "Refused.")).toBe(expected);
  });

  it("cloud failures keep the specific folder that helps people find their files", () => {
    expect(graphError(403, "", "save_the_file")).toBe(
      "OneDrive refused to save the file. Live Diagrams can only use files in its own folder (Apps › Diagrams).",
    );
    expect(dropboxError(409, '{"error_summary":"path/not_found/.."}', "read_the_file")).toBe(
      "That Dropbox file no longer exists, or it was moved out of the Diagrams folder.",
    );
  });

  it("file sizes retain each surface's units, precision and capitalization", () => {
    expect(formatBytes(1250, { storage: true })).toBe("1 KB");
    expect(formatBytes(1_234_567, { unit: "kilobyte" })).toBe("1235 kB");
    expect(importTooLarge("large.json", 16_000_000)).toBe(
      "Couldn't import large.json. It's too large to open (16.0 MB; the limit is 8 MB).",
    );
    expect(formatBytes(1_150_000, { storage: true })).toBe("1.1 MB");
  });

  it("imported traffic keeps its rate precision and seconds/minutes", () => {
    expect(formatImportTraffic(10.123, 30)).toEqual({ rate: "10.123 msg/s", duration: "30 s" });
    expect(formatImportTraffic(1200, 90)).toEqual({ rate: "1200 msg/s", duration: "1.5 min" });
    expect(formatImportTraffic(1e-8, 61)).toEqual({ rate: "1e-8 msg/s", duration: `${61 / 60} min` });
  });

  it("import lists keep each reader's separators without adding an Oxford comma", () => {
    expect(formatImportList(["a", "b", "c"])).toBe("a, b and c");
    expect(formatImportList(["a", "b", "c"], "and")).toBe("a and b and c");
    expect(formatImportList(["a", "b", "c"], "comma")).toBe("a, b, c");
  });
});

it.each(Object.keys(catalogs).filter((code) => code !== "en-XA"))(
  "%s: save/open failures interpolate the provider and image failures interpolate the format",
  async (code) => {
    state.l = code;
    state.c = (await catalogs[code]()).default as Catalog;
    for (const action of ["saveProvider", "openProvider", "image"] as const) {
      const message = fileFailure({ action, name: "DestinationOrFormat" }, "FailureReason");
      expect(message).toContain("DestinationOrFormat");
      expect(message).toContain("FailureReason");
      expect(message).not.toContain("Couldn't");
      expect(message).not.toContain("{provider}");
      expect(message).not.toContain("{format}");
    }
  },
);
