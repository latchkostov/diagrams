import { afterEach, expect, it, vi } from "vitest";
import { loadCanvasFonts } from "./canvasFonts";

afterEach(() => vi.unstubAllGlobals());
it("registers one shared 90-percent tabular canvas face per font set", async () => {
  const faces: { family: string; descriptors?: FontFaceDescriptors }[] = [];
  vi.stubGlobal(
    "FontFace",
    class {
      constructor(family: string, _source: string, descriptors?: FontFaceDescriptors) {
        faces.push({ family, descriptors });
      }
      load() {
        return Promise.resolve(this);
      }
    },
  );
  const add = vi.fn();
  const set = { add } as unknown as FontFaceSet;
  const first = loadCanvasFonts(set);
  expect(loadCanvasFonts(set)).toBe(first);
  await first;
  const numeric = faces.filter((face) => face.family === "Mona Sans Canvas");
  expect(numeric).toHaveLength(2);
  for (const face of numeric)
    expect(face.descriptors).toMatchObject({ variationSettings: '"wdth" 90', featureSettings: '"tnum" 1' });
  expect(add).toHaveBeenCalledTimes(4);
});
