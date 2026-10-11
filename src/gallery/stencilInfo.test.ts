import { describe, expect, it } from "vitest";
import { iconSource } from "./stencilInfo";

describe("iconSource", () => {
  it("names the icon set for icons outside gilbarbara/logos", () => {
    expect(iconSource("pulsar").source).toBe("Simple Icons");
    expect(iconSource("jaeger")).toEqual({ source: "Devicon", licence: "MIT" });
    expect(iconSource("keycloak")).toEqual({ source: "theSVG", licence: "MIT" });
    expect(iconSource("kafka").source).toBe("gilbarbara/logos");
  });
});
