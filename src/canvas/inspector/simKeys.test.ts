import { expect, it } from "vitest";
import { SIM_FIELDS } from "./simFields";
import { SIM_FIELD_KEYS } from "./simKeys";

it("lists exactly the simulation fields that have a control", () => {
  expect([...SIM_FIELD_KEYS]).toEqual(Object.keys(SIM_FIELDS));
});
