import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { examples } from "./index";
import { RETIRED_EXAMPLES, currentExampleSlug, redirectRetiredExample } from "./retired";

// Public fixtures only: this shallow glob never descends into local-only examples.
const files = import.meta.glob<DiagramFile>("./*.json", { eager: true, import: "default" });
const publicSlugs = examples.filter((e) => !e.localOnly).map((e) => e.slug);

describe("retired examples", () => {
  it("redirect to a current public example, with every saved story mapped to one of its stories", () => {
    for (const [slug, retired] of Object.entries(RETIRED_EXAMPLES)) {
      expect(publicSlugs, slug).not.toContain(slug);
      expect(files[`./${slug}.json`], slug).toBeUndefined();
      expect(publicSlugs, slug).toContain(retired.replacement);
      const stories = (files[`./${retired.replacement}.json`].simulations ?? []).map((s) => s.id);
      for (const [from, to] of Object.entries(retired.simulations)) expect(stories, `${slug}:${from}`).toContain(to);
    }
  });

  it("leave current examples, your diagrams and unknown slugs alone", () => {
    for (const slug of [...publicSlugs, "my-0123456789ab", "new", "shared", "toString", "__proto__"])
      expect(currentExampleSlug(slug)).toBe(slug);
    expect(currentExampleSlug("iot-telemetry")).toBe("ev-charging-network");
    expect(redirectRetiredExample("https://www.livediagrams.dev/?view=canvas&example=kafka-order-pipeline")).toBeNull();
    expect(redirectRetiredExample("https://www.livediagrams.dev/?view=canvas&example=constructor")).toBeNull();
    expect(redirectRetiredExample("https://www.livediagrams.dev/#d=abc")).toBeNull();
  });

  it("rewrite the address, keeping every other parameter and the fragment", () => {
    expect(
      redirectRetiredExample(
        "https://www.livediagrams.dev/?view=canvas&example=aws-fanout&live=1&sim=throttle&speed=2#x",
      ),
    ).toBe("https://www.livediagrams.dev/?view=canvas&example=aws-serverless-orders&live=1&sim=throttle&speed=2#x");
    expect(redirectRetiredExample("http://localhost:7040/sub/?example=keda-render-workers&sim=two-bursts")).toBe(
      "http://localhost:7040/sub/?example=autoscaling-basics&sim=wake-on-burst",
    );
    expect(redirectRetiredExample("https://www.livediagrams.dev/?view=embed&example=multi-region-active-active")).toBe(
      "https://www.livediagrams.dev/?view=embed&example=cell-based-bookings",
    );
    // A story the replacement doesn't tell still opens Live, in free play.
    expect(redirectRetiredExample("https://www.livediagrams.dev/?example=iot-telemetry&sim=gone")).toBe(
      "https://www.livediagrams.dev/?example=ev-charging-network&live=1",
    );
  });
});
