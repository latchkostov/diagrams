import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Connect, ViteDevServer } from "vite";
import { beforeEach, expect, it, vi } from "vitest";
import { deflateAsync } from "@gfx/zopfli";
import { readSkill, skillAssetsPlugin, SKILL_ZIP } from "../../scripts/skill-assets";
import { zipSkillInWorker } from "../../scripts/skill-zip-worker";
import { zipSkill } from "../../scripts/skill-assets";
import { RELEASED } from "../../scripts/skill-viewer";

vi.mock("../../scripts/skill-zip-worker", () => ({ zipSkillInWorker: vi.fn() }));
vi.mock("@gfx/zopfli", () => ({ deflateAsync: vi.fn() }));
beforeEach(() => {
  vi.mocked(deflateAsync).mockReset();
  vi.mocked(zipSkillInWorker)
    .mockReset()
    .mockImplementation((files) => zipSkill(files));
});

function serving(template = vi.fn(async () => "fresh viewer")) {
  const watcher = new EventEmitter();
  let middleware: Connect.NextHandleFunction;
  const plugin = skillAssetsPlugin(template);
  const configure = plugin.configureServer;
  if (typeof configure !== "function") throw new Error("Missing configureServer");
  configure.call(
    {} as ThisParameterType<typeof configure>,
    {
      watcher,
      middlewares: { use: (handler: Connect.NextHandleFunction) => (middleware = handler) },
    } as unknown as ViteDevServer,
  );
  const request = (url: string) => {
    const end = vi.fn();
    const next = vi.fn();
    const setHeader = vi.fn();
    middleware({ url } as IncomingMessage, { end, setHeader } as unknown as ServerResponse, next);
    return { end, next, setHeader };
  };
  return { request, watcher, template };
}

// Drain async file/template continuations; a held compressor remains pending without any elapsed-time wait.
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

it("serves fresh viewer files without starting compression, including after invalidation", async () => {
  const { request, watcher, template } = serving();
  for (let i = 0; i < 2; i++) {
    const viewer = request(`/skill/${RELEASED.template}?download=1`);
    const icons = request(`/skill/${RELEASED.icons}`);
    await turn();
    expect(viewer.end).toHaveBeenCalledWith(Buffer.from("fresh viewer"));
    expect(icons.end).toHaveBeenCalledOnce();
    expect(viewer.next).not.toHaveBeenCalled();
    expect(deflateAsync).not.toHaveBeenCalled();
    expect(template).toHaveBeenCalledTimes(i + 1);
    watcher.emit("all", "change", "skill-source");
  }
});

it("serves files while ZIP compression is held and caches ZIPs only until a source change", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(deflateAsync).mockImplementation(async (data) => {
    await held;
    return deflateRawSync(typeof data === "string" ? data : Buffer.from(data));
  });
  const { request, watcher } = serving();
  const zip = request(`/${SKILL_ZIP}`);
  const twin = request(`/${SKILL_ZIP}`);
  await turn();
  expect(deflateAsync).toHaveBeenCalledOnce();
  expect(zip.end).not.toHaveBeenCalled();
  const viewer = request(`/skill/${RELEASED.template}`);
  const ordinary = request("/skill/SKILL.md");
  await turn();
  expect(viewer.end).toHaveBeenCalledWith(Buffer.from("fresh viewer"));
  expect(ordinary.end).toHaveBeenCalledWith(readSkill().find((f) => f.name === "SKILL.md")!.data);
  release();
  await turn();
  const bytes = zip.end.mock.calls[0][0] as Buffer;
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(twin.end).toHaveBeenCalledWith(bytes);
  const count = vi.mocked(deflateAsync).mock.calls.length;
  const cached = request(`/${SKILL_ZIP}`);
  await turn();
  expect(cached.end).toHaveBeenCalledWith(bytes);
  expect(deflateAsync).toHaveBeenCalledTimes(count);
  watcher.emit("all", "change", "skill-source");
  const fresh = request(`/${SKILL_ZIP}`);
  await turn();
  expect(fresh.end).toHaveBeenCalledWith(bytes);
  expect(deflateAsync).toHaveBeenCalledTimes(count * 2);
});

it("retries a failed ZIP without blocking subsequent viewer requests", async () => {
  vi.mocked(deflateAsync).mockRejectedValueOnce(new Error("compression failed"));
  const { request } = serving();
  const failed = request(`/${SKILL_ZIP}`);
  await turn();
  expect(failed.next).toHaveBeenCalledWith(new Error("compression failed"));
  const viewer = request(`/skill/${RELEASED.template}`);
  await turn();
  expect(viewer.end).toHaveBeenCalledWith(Buffer.from("fresh viewer"));
  vi.mocked(deflateAsync).mockImplementation(async (data) =>
    deflateRawSync(typeof data === "string" ? data : Buffer.from(data)),
  );
  const retry = request(`/${SKILL_ZIP}`);
  await turn();
  expect(retry.end).toHaveBeenCalledOnce();
  expect(retry.next).not.toHaveBeenCalled();
});

function viewerInZip(bytes: Buffer) {
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    if (name === `livediagrams/${RELEASED.template}`)
      return inflateRawSync(bytes.subarray(start, start + size)).toString();
    offset = start + size;
  }
  throw new Error("Downloaded ZIP has no viewer");
}

it("downloads the changed viewer after invalidation, even while the old ZIP is pending", async () => {
  vi.mocked(deflateAsync).mockImplementation(async (data) =>
    deflateRawSync(typeof data === "string" ? data : Buffer.from(data)),
  );
  const template = vi.fn(async () => "viewer before edit");
  const { request, watcher } = serving(template);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(zipSkillInWorker).mockImplementationOnce(async (files) => {
    await held;
    return zipSkill(files);
  });
  const old = request(`/${SKILL_ZIP}`);
  await turn();
  template.mockResolvedValue("viewer after edit");
  watcher.emit("all", "change", "viewer-source");
  const fresh = request(`/${SKILL_ZIP}`);
  await turn();
  expect(viewerInZip(fresh.end.mock.calls[0][0] as Buffer)).toBe("viewer after edit");
  expect(old.end).not.toHaveBeenCalled();
  release();
  await turn();
  expect(viewerInZip(old.end.mock.calls[0][0] as Buffer)).toBe("viewer before edit");
  const cached = request(`/${SKILL_ZIP}`);
  await turn();
  expect(viewerInZip(cached.end.mock.calls[0][0] as Buffer)).toBe("viewer after edit");
  expect(template).toHaveBeenCalledTimes(2);
  expect(zipSkillInWorker).toHaveBeenCalledTimes(2);
});
