// Retired public examples (docs/EXAMPLES.md). A retired slug keeps working: links (`?example=`), shared and embedded
// URLs, the remembered last canvas and saved simulation ids open its replacement, and edits saved under the old slug
// become one of your diagrams (adoptRetiredExampleEdits in src/lib/diagramIO.ts). Tiny and diagram-free: the entry
// reads it before anything else does.

export interface RetiredExample {
  /** The public example that replaced it. */
  replacement: string;
  /** Its saved simulation ids, mapped to the replacement's closest story. */
  simulations: Readonly<Record<string, string>>;
}

export const RETIRED_EXAMPLES: Readonly<Record<string, RetiredExample>> = {
  "multi-region-active-active": {
    replacement: "cell-based-bookings",
    simulations: { failover: "region-evacuation", "both-write": "region-evacuation" },
  },
  "iot-telemetry": {
    replacement: "ev-charging-network",
    simulations: { morning: "reboot-storm", "hot-spot": "hot-spot" },
  },
  "aws-fanout": {
    replacement: "aws-serverless-orders",
    simulations: { "steady-spike": "flash-sale", throttle: "throttle" },
  },
  "autoscaling-image-workers": {
    replacement: "autoscaling-basics",
    simulations: { "upload-burst": "upload-burst", "settle-down": "upload-burst" },
  },
  "keda-render-workers": {
    replacement: "autoscaling-basics",
    simulations: { "wake-on-burst": "wake-on-burst", "two-bursts": "wake-on-burst" },
  },
};

const own = (slug: string): RetiredExample | undefined =>
  Object.prototype.hasOwnProperty.call(RETIRED_EXAMPLES, slug) ? RETIRED_EXAMPLES[slug] : undefined;

/** The slug to open for `slug`: its replacement when it's a retired example, else itself. */
export function currentExampleSlug(slug: string): string {
  return own(slug)?.replacement ?? slug;
}

/**
 * The same address with a retired `example` (and its `sim`) replaced, or null when there's nothing to change.
 * Every other parameter and the fragment are kept.
 */
export function redirectRetiredExample(href: string): string | null {
  const url = new URL(href);
  const slug = url.searchParams.get("example");
  const retired = slug === null ? undefined : own(slug);
  if (!retired) return null;
  url.searchParams.set("example", retired.replacement);
  const sim = url.searchParams.get("sim");
  if (sim !== null) {
    const mapped = Object.prototype.hasOwnProperty.call(retired.simulations, sim) ? retired.simulations[sim] : null;
    if (mapped) url.searchParams.set("sim", mapped);
    else {
      // Still Live, in free play: an unknown story never opens the editor instead.
      url.searchParams.delete("sim");
      url.searchParams.set("live", "1");
    }
  }
  return url.toString();
}
