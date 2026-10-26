import latin from "@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2?url";
import extended from "@fontsource-variable/mona-sans/files/mona-sans-latin-ext-wdth-normal.woff2?url";

const loading = new WeakMap<FontFaceSet, Promise<void>>();
/** The same existing face in the document and worker. Canvas shorthand cannot express a 90% width. */
export function loadCanvasFonts(set: FontFaceSet | undefined): Promise<void> {
  if (!set || typeof FontFace !== "function") return Promise.resolve();
  const pending = loading.get(set);
  if (pending) return pending;
  const faces = ["Mona Sans Variable", "Mona Sans Canvas"].flatMap((family) =>
    [latin, extended].map(
      (source) =>
        new FontFace(family, `url(${source})`, {
          weight: "200 900",
          stretch: "75% 125%",
          featureSettings: family === "Mona Sans Canvas" ? '"tnum" 1' : "normal",
          variationSettings: family === "Mona Sans Canvas" ? '"wdth" 90' : "normal",
          unicodeRange:
            source === latin
              ? "U+0000-00FF,U+2000-206F,U+2190-21FF"
              : "U+0100-1EFF,U+20A0-20AB,U+2C60-2C7F,U+A720-A7FF",
        }),
    ),
  );
  for (const face of faces) set.add(face);
  const ready = Promise.all(faces.map((face) => face.load())).then(() => {});
  loading.set(set, ready);
  return ready;
}
