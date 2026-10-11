import { LIMITS, tooLargeMessage } from "../native";
import { fsAccessSupported, openWithPicker, saveWithPicker, writeHandle, type FileHandle } from "../files";
import { StorageError, type StorageProvider } from "./types";

// "This device": real files through the File System Access API (Chrome, Edge), where Save writes
// back to the same file. Browsers without it download on save and use a file input to open; that
// fallback lives in useInterop (it needs the page's hidden <input type=file>).

export const deviceProvider: StorageProvider<FileHandle> = {
  id: "device",
  label: "This device",
  icon: "device",
  isConfigured: () => true,
  signIn: async () => {},
  signOut: () => {},
  isSignedIn: () => true,

  async open() {
    if (!fsAccessSupported()) throw new StorageError("This browser can't open files from here.");
    const picked = await openWithPicker();
    if (!picked) return undefined;
    const { file, handle } = picked;
    // Check the size before reading anything into memory.
    if (file.size > LIMITS.maxTextChars)
      throw new StorageError(`Couldn't import ${file.name}. ${tooLargeMessage(file.size)}`, undefined, true);
    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new StorageError(`Couldn't read ${file.name}.`, undefined, true);
    }
    return { name: file.name, text, ref: handle };
  },

  async save(handle, text) {
    await writeHandle(handle, text);
    return { name: handle.name, ref: handle };
  },

  async saveAs(name, text) {
    const handle = await saveWithPicker(text, name);
    return handle ? { name: handle.name, ref: handle } : undefined;
  },
};
