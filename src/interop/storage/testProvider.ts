import { OPENABLE, StorageError, type StorageEntry, type StorageProvider } from "./types";

// A fake cloud provider for end-to-end tests: files live in this browser's localStorage, with no
// sign-in and no network. Dev builds only, and only with `?storage=test` in the URL (registry.ts);
// the production build drops it entirely.
//
// Tests read the files from localStorage (TEST_STORAGE_KEY) and can make the next call fail with
// `localStorage.setItem("diagrams.test-storage.fail", "save" | "open")`.

export const TEST_STORAGE_KEY = "diagrams.test-storage.v1";
const FAIL_KEY = "diagrams.test-storage.fail";

interface TestFile {
  id: string;
  name: string;
  text: string;
  modified: string;
}

const read = (): TestFile[] => {
  try {
    const files = JSON.parse(localStorage.getItem(TEST_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(files) ? (files as TestFile[]) : [];
  } catch {
    return [];
  }
};
const write = (files: TestFile[]) => localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(files));
const failing = (what: string) => {
  if (localStorage.getItem(FAIL_KEY) !== what) return;
  localStorage.removeItem(FAIL_KEY);
  throw new StorageError(`Test storage refused to ${what} the file (a simulated failure).`);
};

type Ref = { id: string };
let signedIn = false;

export const testProvider: StorageProvider<Ref> = {
  id: "test",
  label: "Test storage",
  icon: "stack",
  folder: "this browser (testing only)",
  isConfigured: () => true,
  signIn: async () => {
    signedIn = true;
  },
  signOut: () => {
    signedIn = false;
  },
  isSignedIn: () => signedIn,
  async list() {
    return read()
      .filter((f) => OPENABLE.test(f.name))
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .map((f): StorageEntry<Ref> => ({ name: f.name, ref: { id: f.id }, modified: f.modified, size: f.text.length }));
  },
  async open(ctx) {
    await this.signIn();
    const picked = (await ctx.choose({ load: () => this.list!() })) as StorageEntry<Ref> | undefined;
    if (!picked) return undefined;
    failing("open");
    const file = read().find((f) => f.id === picked.ref.id);
    if (!file) throw new StorageError("That file no longer exists in Test storage.");
    return { name: file.name, text: file.text, ref: { id: file.id } };
  },
  async save(ref, text) {
    failing("save");
    const files = read();
    const file = files.find((f) => f.id === ref.id);
    if (!file) throw new StorageError("That file no longer exists in Test storage.");
    file.text = text;
    file.modified = new Date().toISOString();
    write(files);
    return { name: file.name, ref };
  },
  async saveAs(name, text) {
    failing("save");
    const files = read();
    let unique = name;
    for (let n = 2; files.some((f) => f.name === unique); n++)
      unique = name.replace(/(\.[^.]+)*$/, (ext) => ` (${n})${ext}`);
    const file = {
      id: `t${files.length + 1}-${Date.now().toString(36)}`,
      name: unique,
      text,
      modified: new Date().toISOString(),
    };
    write([...files, file]);
    return { name: file.name, ref: { id: file.id } };
  },
};
