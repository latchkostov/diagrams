import { expect, it } from "vitest";
import { workChoices } from "./diagramPicker";
const yours = (slug: string) => ({ slug, group: "yours" as const });
it("keeps older current work first and excludes built-in examples", () => {
  const options = [
    ...Array.from({ length: 10 }, (_, i) => yours(`my-${i}`)),
    { slug: "example", group: "examples" as const },
  ];
  const choices = workChoices(options, "my-9");
  expect(choices.items.map((o) => o.slug)).toEqual(["my-9", "my-0", "my-1", "my-2", "my-3", "my-4", "my-5", "my-6"]);
  expect(choices.overflow).toBe(true);
});
it("offers the full library when a draft adds a ninth choice to eight saved diagrams", () => {
  const saved = Array.from({ length: 8 }, (_, i) => yours(`my-${i}`));
  expect(workChoices(saved).overflow).toBe(false);
  expect(workChoices([yours("new"), ...saved], "new").overflow).toBe(true);
});
