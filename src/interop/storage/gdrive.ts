import { driveEnabled, NATIVE_MIME } from "../gdrive/config";
import { driveClient, getDriveToken, pickDriveFile, preloadDrive, signOutDrive } from "../gdrive/google";
import type { StorageProvider } from "./types";

// Google Drive on the provider interface: the Google Picker to open (scope drive.file, so only files
// the user picks or this app created), Drive REST v3 to read and write. The REST client and the
// Google Identity Services glue are unchanged in src/interop/gdrive/.

type DriveRef = { id: string };

let signedIn = false;

export const gdriveProvider: StorageProvider<DriveRef> = {
  id: "gdrive",
  label: "Google Drive",
  icon: "drive",
  isConfigured: () => driveEnabled,
  preload: preloadDrive,

  async signIn() {
    await getDriveToken();
    signedIn = true;
  },
  signOut() {
    signOutDrive();
    signedIn = false;
  },
  isSignedIn: () => signedIn,

  async open(ctx) {
    const picked = await pickDriveFile();
    signedIn = true;
    if (!picked) return undefined;
    const done = ctx.progress(`Opening ${picked.name}…`);
    const file = await driveClient().download(picked.id);
    done();
    return { name: file.name, text: file.text, ref: { id: file.id } };
  },

  async save(ref, text, opts) {
    const file = await driveClient().update(ref.id, { content: text, mimeType: NATIVE_MIME }, opts?.signal);
    signedIn = true;
    return { name: file.name, ref: { id: file.id }, url: file.webViewLink };
  },

  async saveAs(name, text, opts) {
    const file = await driveClient().create({ name, mimeType: NATIVE_MIME, content: text }, opts?.signal);
    signedIn = true;
    return { name: file.name, ref: { id: file.id }, url: file.webViewLink };
  },
};
