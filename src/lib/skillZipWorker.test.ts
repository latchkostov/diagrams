import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import * as zlib from "node:zlib";
import { zipSkill } from "../../scripts/skill-assets";
import { zipSkillInWorker } from "../../scripts/skill-zip-worker";

vi.mock("node:zlib", async (original) => {
  const real = await original<typeof import("node:zlib")>();
  return { ...real, deflateRawSync: vi.fn(real.deflateRawSync) };
});

it("compresses off the request thread and preserves every production ZIP byte", async () => {
  const files = [
    { name: "SKILL.md", data: Buffer.from("A repeatable skill payload. ".repeat(24)) },
    { name: "scripts/lib/viewer-template.html", data: Buffer.from("<html>fresh viewer</html>".repeat(24)) },
  ];
  const expected = await zipSkill(files);
  expect(createHash("sha256").update(expected).digest("hex")).toBe(
    "829d1139a25c69fabc8a7c0f2eed703e2ef475bdd70604bf7789708517c7dceb",
  );
  const sync = vi.mocked(zlib.deflateRawSync).mockClear();
  try {
    expect(await zipSkillInWorker(files)).toEqual(expected);
    expect(sync).not.toHaveBeenCalled();
  } finally {
    sync.mockRestore();
  }
});

it("rejects compression errors and aborts workers when the dev server closes", async () => {
  await expect(zipSkillInWorker([{ name: "invalid", data: null as unknown as Buffer }])).rejects.toThrow();
  const controller = new AbortController();
  const pending = zipSkillInWorker([{ name: "SKILL.md", data: Buffer.from("skill") }], controller.signal);
  controller.abort(new Error("dev server closed"));
  await expect(pending).rejects.toThrow("dev server closed");
  expect(() => zipSkillInWorker([], controller.signal)).toThrow("dev server closed");
});
