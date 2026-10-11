import { expect, it } from "vitest";
import {
  DEFAULT_NODE_VARIANT,
  getNodeVariant,
  isNodeVariantId,
  nodeVariants,
  type NodeVariantId,
} from "./nodeVariants";

it("rejects inherited renderer names and resolves them to the default", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    expect(isNodeVariantId(name)).toBe(false);
    expect(getNodeVariant(name as NodeVariantId)).toBe(nodeVariants[DEFAULT_NODE_VARIANT]);
  }
  expect(isNodeVariantId("compact")).toBe(true);
});
