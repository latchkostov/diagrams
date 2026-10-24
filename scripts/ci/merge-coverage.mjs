import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { createContext, createAsync } from "@vitest/istanbul-lib-report";

const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en")))
      : item,
  );

/** Remapped compiler branches can share a start position. Keep their complete identity and multiplicity. */
export function mergeCoverage(parts) {
  const files = new Map();
  for (const part of parts)
    for (const [file, data] of Object.entries(part)) {
      if (data.path !== file) throw new Error(`Coverage path mismatch: ${file}`);
      const groups = files.get(file) ?? { statementMap: new Map(), fnMap: new Map(), branchMap: new Map() };
      files.set(file, groups);
      for (const [map, counts] of [
        ["statementMap", "s"],
        ["fnMap", "f"],
        ["branchMap", "b"],
      ]) {
        const occurrences = new Map();
        for (const [id, metadata] of Object.entries(data[map])) {
          const identity = stable(metadata);
          const ordinal = occurrences.get(identity) ?? 0;
          occurrences.set(identity, ordinal + 1);
          const key = `${identity}:${ordinal}`;
          const hits = counts === "b" ? data[counts][id] : [data[counts][id]];
          if (
            !Array.isArray(hits) ||
            (counts === "b" && hits.length !== metadata.locations.length) ||
            hits.some((n) => !Number.isSafeInteger(n) || n < 0)
          )
            throw new Error(`Invalid coverage counter: ${file} ${counts}.${id}`);
          const entry = groups[map].get(key) ?? {
            identity,
            ordinal,
            metadata: JSON.parse(identity),
            hits: hits.map(() => 0),
          };
          if (entry.hits.length !== hits.length) throw new Error(`Coverage counter shape mismatch: ${file} ${map}`);
          hits.forEach((n, index) => {
            const sum = entry.hits[index] + n;
            if (!Number.isSafeInteger(sum)) throw new Error(`Invalid coverage counter: ${file} ${counts}.${id}`);
            entry.hits[index] = sum;
          });
          groups[map].set(key, entry);
        }
      }
    }
  return Object.fromEntries(
    [...files]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([file, groups]) => {
        const result = { path: file, statementMap: {}, fnMap: {}, branchMap: {}, s: {}, f: {}, b: {} };
        for (const [map, counts] of [
          ["statementMap", "s"],
          ["fnMap", "f"],
          ["branchMap", "b"],
        ])
          [...groups[map].values()]
            .sort((a, b) => a.identity.localeCompare(b.identity, "en") || a.ordinal - b.ordinal)
            .forEach((entry, index) => {
              result[map][index] = entry.metadata;
              result[counts][index] = counts === "b" ? entry.hits : entry.hits[0];
            });
        return [file, result];
      }),
  );
}

export async function writeCoverage(parts, directory) {
  mkdirSync(directory, { recursive: true });
  const coverageMap = createCoverageMap(mergeCoverage(parts));
  const context = createContext({ dir: directory, coverageMap });
  for (const format of ["json", "json-summary", "html", "text-summary"])
    (await createAsync(format, {})).execute(context);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [input, output, expected = "3"] = process.argv.slice(2);
    const find = (directory) =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? find(file) : entry.name === "coverage-final.json" ? [file] : [];
      });
    const files = find(input).sort();
    if (!Number.isSafeInteger(Number(expected)) || Number(expected) < 1 || files.length !== Number(expected))
      throw new Error(`Expected ${expected} coverage shards, found ${files.length}`);
    await writeCoverage(
      files.map((file) => JSON.parse(readFileSync(file, "utf8"))),
      output,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
