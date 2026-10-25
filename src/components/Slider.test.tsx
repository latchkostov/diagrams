import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Slider } from "./Slider";

describe("Slider component", () => {
  it("renders with given value, min, max and test IDs", () => {
    const html = renderToString(
      <Slider label="Border radius" value={20} min={0} max={40} testId="test-slider" onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="test-slider"');
    expect(html).toContain('data-testid="test-slider-slider"');
    expect(html).toContain('data-testid="test-slider-input"');
    expect(html).toContain('value="20"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="40"');
    expect(html).toContain('aria-label="Border radius"');
  });

  it("clamps values outside min and max", () => {
    const html = renderToString(
      <Slider label="Border radius" value={150} min={0} max={40} testId="test-slider" onChange={() => {}} />,
    );
    expect(html).toContain('value="40"');
  });

  it("can hide direct input when showInput is false", () => {
    const html = renderToString(
      <Slider label="Border radius" value={20} showInput={false} testId="test-slider" onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="test-slider-slider"');
    expect(html).not.toContain('data-testid="test-slider-input"');
  });
});
