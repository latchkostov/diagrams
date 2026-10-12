import { describe, expect, it } from "vitest";
import { dataUrlToBlob } from "./files";

describe("dataUrlToBlob", () => {
  it("decodes base64 and percent-encoded data: URLs without fetch (the CSP's connect-src allows no data:)", async () => {
    const png = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(png.type).toBe("image/png");
    expect([...new Uint8Array(await png.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const svg = dataUrlToBlob("data:image/svg+xml;charset=utf-8,%3Csvg%3E%E2%9C%93%3C%2Fsvg%3E");
    expect(svg.type).toBe("image/svg+xml;charset=utf-8");
    expect(await svg.text()).toBe("<svg>✓</svg>");
    expect(() => dataUrlToBlob("https://example.com/x.png")).toThrow(/data: URL/);
  });
});
