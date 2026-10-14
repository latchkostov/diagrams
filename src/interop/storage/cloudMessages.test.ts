import { afterEach, expect, expectTypeOf, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../../i18n";
import { graphError } from "./onedrive";
import { dropboxError } from "./dropbox";
import { cloudMessages, cloudNetwork } from "./cloudMessages";
import type { CloudOperation } from "./types";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

it("cloud clients accept the same closed set of operation identifiers", () => {
  expectTypeOf(graphError).parameter(2).toEqualTypeOf<CloudOperation>();
  expectTypeOf(dropboxError).parameter(2).toEqualTypeOf<CloudOperation>();
});

it("every operation uses a full shared sentence with the provider and recovery guidance", async () => {
  const operations: [CloudOperation, string][] = [
    ["read_the_file_details", "read the file details"],
    ["download_the_file", "download the file"],
    ["save_the_file", "save the file"],
    ["update_the_file", "update the file"],
    ["list_your_diagrams", "list your diagrams"],
    ["read_the_file", "read the file"],
  ];
  for (const [provider, error] of [
    ["OneDrive", graphError],
    ["Dropbox", dropboxError],
  ] as const) {
    for (const [operation, english] of operations) {
      expect(error(400, "", operation)).toBe(`Couldn't ${english} on ${provider} (400).`);
      expect(error(401, "", operation)).toContain(`trying to ${english}`);
      expect(cloudNetwork(provider, operation)).toBe(
        `Couldn't reach ${provider} to ${english}. Check your connection.`,
      );
    }
  }
  const english = cloudMessages.expired("Google Drive", "save_the_file");
  state.l = "ar";
  state.c = (await catalogs.ar()).default as Catalog;
  const translated = cloudMessages.expired("Google Drive", "save_the_file");
  expect(translated).toContain("Google Drive");
  expect(translated).not.toBe(english);
});
